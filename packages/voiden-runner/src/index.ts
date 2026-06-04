#!/usr/bin/env node
import { program } from 'commander'
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { resolve, basename, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir } from 'fs/promises'
import chalk from 'chalk'
import { runVoidFile } from './runner.js'
import { loadEnabledPlugins } from './plugins/loader.js'
import { exportToCsv } from './report/csv.js'
import { sendMailReport } from './report/mail.js'
import { CORE_PLUGINS, findPlugin } from './plugins/registry.js'
import {
  fetchCommunityPlugins,
  findCommunityPlugin,
  hasCommunityRunner,
  installCommunityRunner,
} from './plugins/community.js'
import {
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  getAllInstalledPlugins,
  readStore,
  STORE_DIR,
} from './plugins/store.js'
import {
  appendSessionResults,
  loadSessionResults,
  clearSession,
} from './session.js'
import type { RunResult, CliReportEntry } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, 'utf-8')
  const env: Record<string, string> = {}
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) throw new Error(`Malformed line ${i + 1} in .env file: missing "="`)
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!key) throw new Error(`Malformed line ${i + 1} in .env file: empty key`)
    env[key] = val
  }
  return env
}


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Recursively collect all .void files under a directory. */
async function collectVoidFiles(inputPath: string): Promise<string[]> {
  const abs = resolve(inputPath)
  if (!existsSync(abs)) return []

  const stat = statSync(abs)
  if (stat.isFile()) {
    return abs.endsWith('.void') ? [abs] : []
  }

  if (stat.isDirectory()) {
    const entries = await readdir(abs, { withFileTypes: true })
    const results: string[] = []
    for (const entry of entries) {
      const full = resolve(abs, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await collectVoidFiles(full)))
      } else if (entry.isFile() && entry.name.endsWith('.void')) {
        results.push(full)
      }
    }
    return results
  }

  return []
}

/** Expand a list of paths/globs into resolved .void file paths. */
async function resolveFiles(patterns: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const dir = resolve(pattern.replace(/\/?\*.*$/, '') || '.')
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.void')) {
          resolved.push(resolve(dir, entry.name))
        }
      }
    } else {
      resolved.push(...(await collectVoidFiles(pattern)))
    }
  }
  return resolved
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY) return () => {}
  let frame = 0
  const interval = setInterval(() => {
    const spin = chalk.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length])
    process.stdout.write(`\r  ${spin}  ${chalk.gray(label)}   `)
    frame++
  }, 80)
  return () => {
    clearInterval(interval)
    process.stdout.write('\r' + ' '.repeat(label.length + 10) + '\r')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run output formatters
// ─────────────────────────────────────────────────────────────────────────────

const DIVIDER = chalk.gray('─'.repeat(64))

function printRunHeader(fileCount: number, pluginCount: number): void {
  console.log()
  console.log(
    chalk.bold.white('  voiden-runner') +
    chalk.gray(` · ${fileCount} file${fileCount !== 1 ? 's' : ''}`) +
    chalk.gray(` · ${pluginCount} plugin${pluginCount !== 1 ? 's' : ''} active`)
  )
  console.log(DIVIDER)
}

// ─────────────────────────────────────────────────────────────────────────────
// Report entry renderer
// ─────────────────────────────────────────────────────────────────────────────

function renderReportEntries(entries: CliReportEntry[], verbose: boolean): void {
  const assertions = entries.filter(e => e.type === 'assertion')
  const logs = entries.filter(e => e.type === 'log')
  const sections = entries.filter(e => e.type === 'section')

  // Assertions — always shown (mirrors the test panel in the app)
  if (assertions.length > 0) {
    const passed = assertions.filter(e => e.type === 'assertion' && e.passed).length
    const failed = assertions.length - passed
    console.log(
      `       assertions: ${chalk.green(`${passed} passed`)}` +
      (failed > 0 ? chalk.red(` · ${failed} failed`) : '')
    )
    for (const e of assertions) {
      if (e.type !== 'assertion') continue
      const icon = e.passed ? chalk.green('  ✓') : chalk.red('  ✗')
      let line = `       ${icon}  ${e.message}`
      if (!e.passed && e.actual !== undefined && e.expected !== undefined) {
        line += chalk.gray(`  (got ${JSON.stringify(e.actual)}, expected ${e.operator ?? '=='} ${JSON.stringify(e.expected)})`)
      }
      console.log(line)
    }
  }

  // Script logs — only shown in verbose mode (same as app behaviour: logs visible in console panel)
  if (verbose && logs.length > 0) {
    const levelIcon: Record<string, string> = {
      info: chalk.blue('ℹ'),
      debug: chalk.gray('•'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      log: chalk.gray('·'),
    }
    for (const e of logs) {
      if (e.type !== 'log') continue
      const icon = (e.level ? levelIcon[e.level] : undefined) ?? chalk.gray('·')
      console.log(chalk.gray(`       ${icon}  ${e.message}`))
    }
  }

  // Section titles — shown when verbose, useful for grouping named test blocks
  if (verbose) {
    for (const e of sections) {
      if (e.type !== 'section') continue
      console.log(chalk.bold.gray(`       ── ${e.title} ──`))
    }
  }
}

function printKeyValue(label: string, obj: Record<string, string> | undefined) {
  if (!obj || Object.keys(obj).length === 0) return
  console.log(chalk.gray(`         ${label}:`))
  for (const [k, v] of Object.entries(obj)) {
    console.log(chalk.gray(`           ${chalk.dim(k + ':')} ${v}`))
  }
}

function printBody(label: string, body: string | undefined) {
  if (!body) return
  console.log(chalk.gray(`         ${label}:`))
  for (const line of body.split('\n')) {
    console.log(chalk.gray(`           ${line}`))
  }
}

function printRequestResult(
  result: RunResult,
  filePath: string,
  index: number,
  total: number,
  showReq: boolean,
  showRes: boolean,
  verbose: boolean,
): void {
  const icon = result.success ? chalk.green('  ✓') : chalk.red('  ✗')
  const counter = chalk.gray(`[${index}/${total}]`)
  const fileName = chalk.bold(basename(filePath))

  console.log()
  console.log(`${counter} ${fileName}`)

  const proto = chalk.cyan(result.protocol.toUpperCase().padEnd(4))
  const method = result.method ? chalk.bold(result.method.padEnd(6)) + ' ' : '       '
  const url = chalk.underline(result.url || '—')
  const time = chalk.gray(formatDuration(result.durationMs))

  let statusPart = ''
  if (result.status !== undefined) {
    const statusColor = result.success ? chalk.green : chalk.red
    statusPart = statusColor(`  ${result.status} ${result.statusText ?? ''}`)
  } else if (result.connected !== undefined) {
    statusPart = result.connected
      ? chalk.green('  Connected')
      : chalk.red('  Failed to connect')
  }

  let sizePart = ''
  if (result.size !== undefined) {
    sizePart = chalk.gray(`  ${formatBytes(result.size)}`)
  }

  console.log(`${icon}  ${proto} ${method}${url}${statusPart}  ${time}${sizePart}`)

  // ── Always show request details on failure (helps debug "fetch failed") ────
  if (!result.success) {
    if (result.error) console.log(chalk.red(`       ${result.error}`))
    console.log(chalk.gray('       ↳ request sent:'))
    console.log(chalk.gray(`           url:    ${result.url || '—'}`))
    if (result.method) console.log(chalk.gray(`           method: ${result.method}`))
    printKeyValue('headers', result.requestHeaders)
    if (result.requestBody) printBody('body', result.requestBody)
  }

  // ── Report entries (emitted by plugins) ───────────────────────────────────
  if (result.reportEntries && result.reportEntries.length > 0) {
    renderReportEntries(result.reportEntries, verbose)
  }

  // ── Legacy assertion fields ───────────────────────────────────────────────
  if (!result.reportEntries && (result.assertionsPassed !== undefined || result.assertionsFailed !== undefined)) {
    const p = result.assertionsPassed ?? 0
    const f = result.assertionsFailed ?? 0
    console.log(`       assertions: ${chalk.green(`${p} passed`)}${f > 0 ? chalk.red(` · ${f} failed`) : ''}`)
  }

  // ── --show-req ────────────────────────────────────────────────────────────
  if (showReq && result.success) {
    console.log(chalk.gray('       ↳ request:'))
    console.log(chalk.gray(`           url:    ${result.url || '—'}`))
    if (result.method) console.log(chalk.gray(`           method: ${result.method}`))
    printKeyValue('headers', result.requestHeaders)
    if (result.requestBody) printBody('body', result.requestBody)
  }

  // ── --show-res ────────────────────────────────────────────────────────────
  if (showRes) {
    console.log(chalk.gray('       ↳ response:'))
    printKeyValue('headers', result.responseHeaders)
    if (result.body) printBody('body', result.body)
  }
}

function printRunSummary(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
): void {
  const passed = results.filter(r => r.result.success).length
  const failed = results.length - passed

  console.log()
  console.log(DIVIDER)

  const passedStr = passed > 0 ? chalk.green(`${passed} passed`) : chalk.gray('0 passed')
  const failedStr = failed > 0 ? chalk.red(`${failed} failed`) : chalk.gray('0 failed')

  console.log(
    `  ${chalk.bold('Summary')}  ` +
    `${results.length} request${results.length !== 1 ? 's' : ''}  ·  ` +
    `${passedStr}  ·  ${failedStr}  ·  ` +
    chalk.gray(formatDuration(totalMs) + ' total')
  )
  console.log(DIVIDER)
  console.log()
}

function printRunSummaryJson(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
  activePlugins: string[],
): void {
  const passed = results.filter(r => r.result.success).length
  const output = {
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      totalDurationMs: totalMs,
      activePlugins,
    },
    requests: results.map(r => ({ file: r.file, ...r.result })),
  }
  console.log(JSON.stringify(output, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const pkgPath = resolve(join(dirname(fileURLToPath(import.meta.url)), '../package.json'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

program
  .name('voiden-runner')
  .description('Run .void files headlessly — REST, WebSocket, and gRPC')
  .version(pkg.version)

// ── voiden-runner run ─────────────────────────────────────────────────────────

program
  .command('run <paths...>')
  .description(
    'Run .void files — accepts files, directories (recursive), or glob patterns\n\n' +
    '  Examples:\n' +
    '    voiden-runner run auth.void\n' +
    '    voiden-runner run ./requests/\n' +
    '    voiden-runner run auth.void users.void ./smoke/\n' +
    '    voiden-runner run ./ --env .env.staging --bail\n'
  )
  .option('-e, --env <path>', 'Path to .env or .yaml file for variable substitution')
  .option('--env-var <key=value>', 'Individual environment variable override (can be used multiple times)', (val, memo: string[]) => {
    memo.push(val)
    return memo
  }, [])
  .option('--show-req', 'Print sent request headers and body for each request')
  .option('--show-res', 'Print response headers and body for each request')
  .option('--bail', 'Stop immediately on first failure and exit 1 (CI fast-fail)')
  .option('--stop-on-failure', 'Alias for --bail: stop on first failure, exit 1 (shell set -e friendly)')
  .option('--fail-on-error', 'Exit with code 1 if any request fails (runs all files first)')
  .option('--verbose', 'Print plugin and script logs')
  .option('--json', 'Output results as JSON (suppresses normal output — useful for CI pipelines)')
  .option('--no-session', 'Completely stateless run — no variables are loaded from disk, shared between files, or saved')
  .option('--output-json <file>', 'Write the full result object to a JSON file — pass to the next CLI, script, or tool')
  .option('--csv <path>', 'Export full report (request + response headers, bodies, assertions) to a CSV file')
  .option('--mail', 'Send HTML report to address specified in VOIDEN_MAIL_TO env')
  .option('--mail-to <address>', 'Send HTML report to this email address')
  .option('--mail-from <address>', 'Sender address for the report email')
  .option('--mail-subject <subject>', 'Email subject line (default: auto-generated summary)')
  .option('--smtp-host <host>', 'SMTP server host')
  .option('--smtp-port <port>', 'SMTP server port')
  .option('--smtp-secure', 'Use TLS for SMTP (true/false)')
  .option('--smtp-user <user>', 'SMTP username')
  .option('--smtp-pass <pass>', 'SMTP password')
  .action(async (paths: string[], opts) => {
    // Priority order (lowest → highest):
    //   system env (process.env) → --env file → --env-var overrides
    //
    // System env is the base so GitHub Actions secrets, GitLab CI variables,
    // and any CI/CD platform vars are automatically available as {{KEY}}
    // without needing an --env file.
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
    )

    // 1. Load --env file (overrides system)
    if (opts.env) {
      const envPath = resolve(opts.env)
      if (!existsSync(envPath)) {
        console.error(chalk.red(`Env file not found: ${envPath}`))
        process.exit(1)
      }
      try {
        Object.assign(env, loadEnvFile(envPath))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  ${err.message}`))
        process.exit(1)
      }
    }

    // 2. Individual --env-var overrides
    if (opts.envVar && Array.isArray(opts.envVar)) {
      for (const pair of opts.envVar) {
        const eq = pair.indexOf('=')
        if (eq === -1) {
          console.error(chalk.red(`  ✗  Invalid --env-var format: "${pair}" (expected key=value)`))
          process.exit(1)
        }
        const key = pair.slice(0, eq).trim()
        const val = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (!key) {
          console.error(chalk.red(`  ✗  Invalid --env-var format: "${pair}" (key cannot be empty)`))
          process.exit(1)
        }
        env[key] = val
      }
    }

    const resolvedFiles = await resolveFiles(paths)

    if (resolvedFiles.length === 0) {
      console.error(chalk.red('No .void files found at the given path(s)'))
      process.exit(1)
    }

    // --stop-on-failure is a CI-friendly alias for --bail
    const stopOnFailure: boolean = opts.bail || opts.stopOnFailure

    // Mail settings — read from CLI options or merged env
    const mailTo = opts.mailTo || (opts.mail ? env.VOIDEN_MAIL_TO : undefined)
    const mailFrom = opts.mailFrom || env.VOIDEN_MAIL_FROM
    const mailSubject = opts.mailSubject || env.VOIDEN_MAIL_SUBJECT

    // SMTP settings — read from CLI options or merged env
    const smtpHost = opts.smtpHost || env.VOIDEN_SMTP_HOST || process.env.VOIDEN_SMTP_HOST
    const smtpPort = parseInt(opts.smtpPort || env.VOIDEN_SMTP_PORT || process.env.VOIDEN_SMTP_PORT || '0') || undefined
    const smtpSecure = opts.smtpSecure || (env.VOIDEN_SMTP_SECURE || process.env.VOIDEN_SMTP_SECURE) === 'true'
    const smtpUser = opts.smtpUser || env.VOIDEN_SMTP_USER || process.env.VOIDEN_SMTP_USER
    const smtpPass = opts.smtpPass || env.VOIDEN_SMTP_PASS || process.env.VOIDEN_SMTP_PASS

    // Validate mail options up-front so we fail fast before running requests
    if (opts.mail || opts.mailTo) {
      if (!mailTo) {
        console.error(chalk.red('  ✗  Mail error: no recipient found. Please provide --mail-to or set VOIDEN_MAIL_TO.'))
        process.exit(1)
      }
      if (!smtpHost) {
        console.error(chalk.red('  ✗  Mail keys are missing. Please provide SMTP configuration (VOIDEN_SMTP_HOST).'))
        process.exit(1)
      }
    }

    const runStart = Date.now()
    let anyFailed = false
    const allResults: Array<{ file: string; result: RunResult }> = []

    // In-memory runtime variables — shared across all files in this run.
    // Captured from {{$res.xxx}} runtime-variable blocks after each request.
    // Available as {{process.KEY}} in subsequent requests and via voiden.variables.get().
    const runtimeVars: Record<string, any> = {}

    // Load persisted runtime variables if not disabled
    const VARS_PATH = join(STORE_DIR, '.process.env.json')
    if (opts.session && existsSync(VARS_PATH)) {
      try {
        const data = JSON.parse(readFileSync(VARS_PATH, 'utf-8'))
        Object.assign(runtimeVars, data)
        if (opts.verbose) console.log(chalk.gray(`  [vars] Loaded ${Object.keys(data).length} persisted variables from ${VARS_PATH}`))
      } catch {
        // Ignore if file is malformed
      }
    }

    // Load plugins once for the entire session — not once per file.
    const activePlugins = await loadEnabledPlugins(opts.verbose ?? false)

    // Collect results
    for (let i = 0; i < resolvedFiles.length; i++) {
      const file = resolvedFiles[i]
      const stopSpinner = opts.json ? () => {} : startSpinner(`[${i + 1}/${resolvedFiles.length}]  ${basename(file)}`)

      try {
        // --no-session: each file is fully isolated — no vars flow from one file to another.
        // Session mode: all files share runtimeVars so captured vars chain across files.
        const fileVars = opts.session ? runtimeVars : {}
        const { results } = await runVoidFile(file, { env, verbose: opts.verbose, runtimeVars: fileVars, activePlugins })
        stopSpinner()
        for (const { result } of results) {
          if (!result.success) anyFailed = true
          allResults.push({ file, result })
        }
      } catch (err: any) {
        stopSpinner()
        anyFailed = true
        allResults.push({
          file,
          result: {
            protocol: 'unknown',
            url: '',
            success: false,
            durationMs: 0,
            error: err?.message || String(err),
          },
        })
      }

      // --bail / --stop-on-failure: halt immediately, let shell set -e propagate
      if (stopOnFailure && anyFailed) {
        console.log()
        console.log(chalk.red(`  ✗  Stopped on first failure — ${resolvedFiles.length - i - 1} file(s) skipped`))
        console.log(chalk.gray('     (exit code 1 — shell set -e will abort the parent script)'))
        break
      }
    }

    // Save session results if not disabled
    if (opts.session) {
      appendSessionResults(allResults)
    }

    const totalMs = Date.now() - runStart

    // Save runtime variables if not disabled
    if (opts.session && Object.keys(runtimeVars).length > 0) {
      try {
        mkdirSync(STORE_DIR, { recursive: true })
        writeFileSync(VARS_PATH, JSON.stringify(runtimeVars, null, 2), 'utf-8')
        if (!opts.json) console.log(chalk.gray(`  [vars] Saved ${Object.keys(runtimeVars).length} runtime variables to ${VARS_PATH}`))
      } catch (err: any) {
        if (opts.verbose) console.error(chalk.red(`  [vars] Failed to save runtime variables: ${err?.message}`))
      }
    }

    if (opts.json) {
      printRunSummaryJson(allResults, totalMs, activePlugins)
    } else {
      printRunHeader(resolvedFiles.length, activePlugins.length)
      for (let i = 0; i < allResults.length; i++) {
        const { file, result } = allResults[i]
        printRequestResult(result, file, i + 1, allResults.length, opts.showReq ?? false, opts.showRes ?? false, opts.verbose ?? false)
      }
      printRunSummary(allResults, totalMs)
    }

    // ── CSV export ────────────────────────────────────────────────────────────
    let savedCsvPath: string | undefined
    if (opts.csv) {
      try {
        savedCsvPath = exportToCsv(allResults, opts.csv)
        console.log(chalk.green(`  ✓  CSV report saved to ${savedCsvPath}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to write CSV: ${err?.message ?? String(err)}`))
      }
    }

    // ── Output JSON to file (before mail so it can be attached) ──────────────
    let savedJsonPath: string | undefined
    if (opts.outputJson) {
      const jsonData = {
        summary: {
          total: allResults.length,
          passed: allResults.filter(r => r.result.success).length,
          failed: allResults.filter(r => !r.result.success).length,
          totalDurationMs: totalMs,
          activePlugins,
        },
        requests: allResults.map(r => ({ file: r.file, ...r.result })),
      }
      try {
        mkdirSync(dirname(opts.outputJson), { recursive: true })
        writeFileSync(opts.outputJson, JSON.stringify(jsonData, null, 2) + '\n', 'utf-8')
        savedJsonPath = opts.outputJson
        if (!opts.json) console.log(chalk.gray(`  ↳ Results written to ${opts.outputJson}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to write JSON: ${err?.message ?? String(err)}`))
      }
    }

    // ── Email report ──────────────────────────────────────────────────────────
    if (mailTo) {
      console.log(chalk.gray(`  ↑  Sending report to ${mailTo} …`))
      try {
        await sendMailReport(allResults, totalMs, {
          to:          mailTo,
          from:        mailFrom,
          subject:     mailSubject,
          smtpHost:    smtpHost!,
          smtpPort:    smtpPort,
          smtpSecure:  smtpSecure,
          smtpUser:    smtpUser,
          smtpPass:    smtpPass,
          csvPath:     savedCsvPath,
          jsonPath:    savedJsonPath,
        })
        console.log(chalk.green(`  ✓  Report sent to ${mailTo}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to send email: ${err?.message ?? String(err)}`))
      }
    }

    const shouldFail = (opts.failOnError || stopOnFailure) && anyFailed
    if (shouldFail && !opts.json) {
      const failedCount = allResults.filter(r => !r.result.success).length
      console.log(chalk.red(`  ✗  Run failed — ${failedCount} request${failedCount !== 1 ? 's' : ''} failed. Exiting with code 1.`))
      console.log(chalk.gray('     (use this exit code in your shell script to abort on failure)'))
      console.log()
    }
    process.exit(shouldFail ? 1 : 0)
  })

// ── voiden-runner session ─────────────────────────────────────────────────────

const sessionCmd = program
  .command('session')
  .description('Manage the current run session')

sessionCmd
  .command('clear')
  .description('Clear all session data (results and runtime variables)')
  .action(() => {
    clearSession()
    console.log(chalk.yellow('  ✓  Full session cleared (results and runtime variables wiped)'))
  })

sessionCmd
  .command('vars')
  .description('List all persisted runtime variables')
  .action(() => {
    const VARS_PATH = join(STORE_DIR, '.process.env.json')
    if (!existsSync(VARS_PATH)) {
      console.log(chalk.gray('  No persisted runtime variables.'))
      return
    }
    try {
      const vars = JSON.parse(readFileSync(VARS_PATH, 'utf-8'))
      const keys = Object.keys(vars)
      if (keys.length === 0) {
        console.log(chalk.gray('  No persisted runtime variables.'))
        return
      }
      console.log()
      console.log(chalk.bold('  Persisted Runtime Variables'))
      console.log(DIVIDER)
      for (const key of keys) {
        const val = typeof vars[key] === 'object' ? JSON.stringify(vars[key]) : String(vars[key])
        console.log(`  ${chalk.bold(key.padEnd(24))} ${chalk.gray(val)}`)
      }
      console.log(DIVIDER)
      console.log()
    } catch {
      console.error(chalk.red('  ✗  Failed to read runtime variables file.'))
    }
  })

sessionCmd
  .command('status')
  .description('Show summary of current session')
  .action(() => {
    const results = loadSessionResults()
    const VARS_PATH = join(STORE_DIR, '.process.env.json')
    const varsCount = existsSync(VARS_PATH) ? Object.keys(JSON.parse(readFileSync(VARS_PATH, 'utf-8'))).length : 0

    console.log()
    console.log(chalk.bold('  Session Status'))
    console.log(DIVIDER)
    console.log(`  Accumulated results:    ${results.length} requests`)
    console.log(`  Runtime variables:      ${varsCount}`)
    console.log(DIVIDER)
    console.log()
  })

// ── voiden-runner report ──────────────────────────────────────────────────────

const reportCmd = program
  .command('report')
  .description('Show and generate reports from accumulated session results')
  .option('--show-req', 'Print sent request headers and body for each request')
  .option('--show-res', 'Print response headers and body for each request')
  .option('--verbose', 'Print plugin and script logs')
  .action((opts) => {
    const results = loadSessionResults()
    if (results.length === 0) {
      console.error(chalk.red('  ✗  No results found in session. Run some .void files first.'))
      return
    }

    console.log()
    console.log(chalk.bold('  Session History'))
    console.log(DIVIDER)
    
    let totalDurationMs = 0
    for (let i = 0; i < results.length; i++) {
      const { file, result } = results[i]
      totalDurationMs += result.durationMs
      printRequestResult(result, file, i + 1, results.length, opts.showReq ?? false, opts.showRes ?? false, opts.verbose ?? false)
    }
    printRunSummary(results, totalDurationMs)
  })

reportCmd
  .command('clear')
  .description('Clear accumulated session results (history) only')
  .action(() => {
    const RESULTS_PATH = join(STORE_DIR, 'results.json')
    if (existsSync(RESULTS_PATH)) {
      unlinkSync(RESULTS_PATH)
      console.log(chalk.yellow('  ✓  Session results cleared (runtime variables preserved)'))
    } else {
      console.log(chalk.gray('  No session results to clear.'))
    }
  })

reportCmd
  .command('generate')
  .description('Generate reports from accumulated session results')
  .alias('gen')
  .option('-e, --env <path>', 'Path to .env or .yaml file for SMTP configuration')
  .option('--csv <path>', 'Export session results to a CSV file')
  .option('--output-json <file>', 'Write full result object to a JSON file (also attached to email if --mail is used)')
  .option('--mail', 'Send HTML report to VOIDEN_MAIL_TO (attaches --csv and/or --output-json if provided)')
  .option('--mail-to <address>', 'Send HTML report to this email address (attaches --csv and/or --output-json if provided)')
  .option('--mail-from <address>', 'Sender address for the report email')
  .option('--mail-subject <subject>', 'Email subject line')
  .option('--smtp-host <host>', 'SMTP server host')
  .option('--smtp-port <port>', 'SMTP server port')
  .option('--smtp-secure', 'Use TLS for SMTP (true/false)')
  .option('--smtp-user <user>', 'SMTP username')
  .option('--smtp-pass <pass>', 'SMTP password')
  .action(async (opts) => {
    const results = loadSessionResults()
    if (results.length === 0) {
      console.error(chalk.red('  ✗  No results found in session. Run some .void files first.'))
      process.exit(1)
    }

    // Load optional .env for report SMTP settings
    const env: Record<string, string> = { ...process.env } as any
    if (opts.env) {
      const envPath = resolve(opts.env)
      if (existsSync(envPath)) {
        try {
          Object.assign(env, loadEnvFile(envPath))
        } catch {}
      }
    }

    const mailTo = opts.mailTo || (opts.mail ? env.VOIDEN_MAIL_TO : undefined)
    const mailFrom = opts.mailFrom || env.VOIDEN_MAIL_FROM
    const mailSubject = opts.mailSubject || env.VOIDEN_MAIL_SUBJECT

    if (opts.mail || opts.mailTo) {
      if (!mailTo) {
        console.error(chalk.red('  ✗  Mail error: no recipient found. Please provide --mail-to or set VOIDEN_MAIL_TO.'))
        process.exit(1)
      }
      const smtpHost = opts.smtpHost || env.VOIDEN_SMTP_HOST
      if (!smtpHost) {
        console.error(chalk.red('  ✗  Mail keys are missing. Please provide SMTP configuration (VOIDEN_SMTP_HOST).'))
        process.exit(1)
      }
    }

    if (!opts.csv && !opts.outputJson && !mailTo) {
      console.log(chalk.gray(`  Session has ${results.length} accumulated results. Specify --csv or --output-json to generate a report.`))
      return
    }

    let savedCsvPath: string | undefined
    if (opts.csv) {
      try {
        savedCsvPath = exportToCsv(results, opts.csv)
        console.log(chalk.green(`  ✓  CSV report saved to ${savedCsvPath}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to write CSV: ${err?.message ?? String(err)}`))
      }
    }

    let savedJsonPath: string | undefined
    if (opts.outputJson) {
      const jsonData = {
        summary: {
          total: results.length,
          passed: results.filter(r => r.result.success).length,
          failed: results.filter(r => !r.result.success).length,
        },
        requests: results.map(r => ({ file: r.file, ...r.result })),
      }
      try {
        mkdirSync(dirname(opts.outputJson), { recursive: true })
        writeFileSync(opts.outputJson, JSON.stringify(jsonData, null, 2) + '\n', 'utf-8')
        savedJsonPath = opts.outputJson
        console.log(chalk.gray(`  ↳ Results written to ${opts.outputJson}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to write JSON: ${err?.message ?? String(err)}`))
      }
    }

    if (mailTo) {
      // SMTP settings — read from CLI options or environment
      const smtpHost = opts.smtpHost || env.VOIDEN_SMTP_HOST || process.env.VOIDEN_SMTP_HOST
      const smtpPort = parseInt(opts.smtpPort || env.VOIDEN_SMTP_PORT || process.env.VOIDEN_SMTP_PORT || '0') || undefined
      const smtpSecure = opts.smtpSecure || (env.VOIDEN_SMTP_SECURE || process.env.VOIDEN_SMTP_SECURE) === 'true'
      const smtpUser = opts.smtpUser || env.VOIDEN_SMTP_USER || process.env.VOIDEN_SMTP_USER
      const smtpPass = opts.smtpPass || env.VOIDEN_SMTP_PASS || process.env.VOIDEN_SMTP_PASS

      if (!smtpHost) {
        console.error(chalk.red('  ✗  SMTP configuration required for email reports.'))
        console.log(chalk.gray('     Set VOIDEN_SMTP_HOST in your environment or use --smtp-host.'))
        process.exit(1)
      }

      console.log(chalk.gray(`  ↑  Sending session report to ${mailTo} …`))
      try {
        await sendMailReport(results, 0, {
          to:          mailTo,
          from:        mailFrom,
          subject:     mailSubject || `Voiden Session Report (${results.length} requests)`,
          smtpHost:    smtpHost!,
          smtpPort:    smtpPort,
          smtpSecure:  smtpSecure,
          smtpUser:    smtpUser,
          smtpPass:    smtpPass,
          csvPath:     savedCsvPath,
          jsonPath:    savedJsonPath,
        })
        console.log(chalk.green(`  ✓  Report sent to ${mailTo}`))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  Failed to send email: ${err?.message ?? String(err)}`))
      }
    }
  })

// ── voiden-runner plugin ──────────────────────────────────────────────────────

const pluginCmd = program
  .command('plugin')
  .description('Manage plugins for .void file execution')

// voiden-runner plugin install [names...] --all
pluginCmd
  .command('install [names...]')
  .description(
    'Install one or more plugins, or all core plugins\n\n' +
    '  --all installs all core plugins only. Community plugins must be installed by name.\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin install --all\n' +
    '    voiden-runner plugin install voiden-scripting\n' +
    '    voiden-runner plugin install apyhub-explorer\n'
  )
  .option('--all', 'Install all core plugins (community plugins must be installed by name)')
  .action(async (names: string[], opts) => {
    const communityPlugins = await fetchCommunityPlugins()

    const targets: string[] = opts.all
      ? CORE_PLUGINS.map(p => p.name)
      : names

    if (targets.length === 0) {
      console.error(chalk.red('Specify plugin name(s) or use --all'))
      console.log(chalk.gray('  Core: ' + CORE_PLUGINS.map(p => p.name).join(', ')))
      if (communityPlugins.length > 0) {
        console.log(chalk.gray('  Community (install by name): ' + communityPlugins.map(p => p.id).join(', ')))
      }
      process.exit(1)
    }

    let installedCount = 0
    for (const name of targets) {
      const coreDef = findPlugin(name)
      const commDef = !coreDef ? findCommunityPlugin(name, communityPlugins) : undefined
      if (!coreDef && !commDef) {
        console.log(chalk.yellow(`  ⚠  Unknown plugin "${name}" — skipped`))
        continue
      }

      // Community plugins: download runner.js from the GitHub release first
      if (commDef) {
        process.stdout.write(`  ↓  Downloading runner for ${chalk.bold(name)} …`)
        try {
          const result = await installCommunityRunner(commDef)
          if (result === 'no-runner') {
            process.stdout.write('\r' + chalk.yellow(`  ⚠  No runner.js in release for "${name}" — skipped\n`))
            continue
          }
          process.stdout.write('\r' + ' '.repeat(60) + '\r') // clear the line
        } catch (err: any) {
          process.stdout.write('\r' + chalk.red(`  ✗  Failed to download runner for "${name}": ${err?.message ?? String(err)}\n`))
          continue
        }
      }

      const description = coreDef ? coreDef.description : commDef!.description
      const fresh = installPlugin(name)
      if (fresh) {
        console.log(chalk.green(`  ✓  Installed`) + chalk.bold(` ${name}`) + chalk.gray(`  —  ${description}`))
        installedCount++
      } else {
        console.log(chalk.gray(`  ·  Already installed`) + ` ${name}`)
      }
    }

    if (installedCount > 0) {
      console.log()
      console.log(chalk.gray(`  ${installedCount} plugin(s) installed. State saved to ~/.voiden/plugins.json`))
    }
  })

// voiden-runner plugin uninstall <name>
pluginCmd
  .command('uninstall <name>')
  .description('Remove an installed plugin\n\n  Example:\n    voiden-runner plugin uninstall voiden-scripting\n')
  .action((name: string) => {
    const removed = uninstallPlugin(name)
    if (removed) {
      console.log(chalk.green(`  ✓  Uninstalled`) + ` ${name}`)
    } else {
      console.log(chalk.yellow(`  ⚠  Plugin "${name}" is not installed`))
    }
  })

// voiden-runner plugin enable [name] --all
pluginCmd
  .command('enable [name]')
  .description(
    'Enable a previously disabled plugin\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin enable voiden-scripting\n' +
    '    voiden-runner plugin enable --all\n'
  )
  .option('--all', 'Enable all disabled plugins (core and community)')
  .action(async (name: string | undefined, opts: { all?: boolean }) => {
    if (opts.all) {
      const store = readStore()
      // Re-enable all explicitly disabled plugins (core + community)
      const disabled = Object.entries(store.installedPlugins)
        .filter(([, r]) => !r.enabled)
        .map(([n]) => n)
      // Also ensure all core plugins that were never in the store are treated as enabled (default)
      const disabledCoreNotInStore: string[] = []
      if (disabled.length === 0 && disabledCoreNotInStore.length === 0) {
        console.log(chalk.gray('  All plugins are already enabled.'))
        return
      }
      for (const n of disabled) {
        setPluginEnabled(n, true)
        console.log(chalk.green(`  ✓  Enabled`) + ` ${n}`)
      }
      console.log(chalk.gray(`  ${disabled.length} plugin(s) enabled.`))
      return
    }
    if (!name) {
      console.error(chalk.red('  Specify a plugin name or use --all'))
      process.exit(1)
    }
    const communityPlugins = await fetchCommunityPlugins()
    const commDef = findCommunityPlugin(name, communityPlugins)
    if (commDef && !hasCommunityRunner(name)) {
      console.log(chalk.red(`  ✗  Cannot enable "${name}" — runner not installed`))
      console.log(chalk.gray(`     Run: voiden-runner plugin install ${name}`))
      process.exit(1)
    }
    setPluginEnabled(name, true)
    console.log(chalk.green(`  ✓  Enabled`) + ` ${name}`)
  })

// voiden-runner plugin disable [name] --all
pluginCmd
  .command('disable [name]')
  .description(
    'Disable a plugin without uninstalling it\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin disable voiden-scripting\n' +
    '    voiden-runner plugin disable --all\n'
  )
  .option('--all', 'Disable all plugins (core and community)')
  .action((name: string | undefined, opts: { all?: boolean }) => {
    if (opts.all) {
      // Disable all core plugins
      for (const def of CORE_PLUGINS) {
        setPluginEnabled(def.name, false)
        console.log(chalk.yellow(`  ·  Disabled`) + ` ${def.name}`)
      }
      // Disable all installed community plugins
      const store = readStore()
      const communityNames = Object.keys(store.installedPlugins).filter(n => !findPlugin(n))
      for (const n of communityNames) {
        setPluginEnabled(n, false)
        console.log(chalk.yellow(`  ·  Disabled`) + ` ${n}`)
      }
      const total = CORE_PLUGINS.length + communityNames.length
      console.log(chalk.gray(`  ${total} plugin(s) disabled.`))
      return
    }
    if (!name) {
      console.error(chalk.red('  Specify a plugin name or use --all'))
      process.exit(1)
    }
    setPluginEnabled(name, false)
    console.log(chalk.yellow(`  ·  Disabled`) + ` ${name}`)
    if (findPlugin(name)) {
      console.log(chalk.gray(`     Core plugin disabled. Re-enable with: voiden-runner plugin enable ${name}`))
    }
  })

// voiden-runner plugin list
pluginCmd
  .command('list')
  .description('List all available and installed plugins')
  .action(async () => {
    const store = readStore()
    const communityPlugins = await fetchCommunityPlugins()

    console.log()
    console.log(chalk.bold('  Core plugins') + chalk.gray('  (from individual plugin repos)'))
    console.log(DIVIDER)

    for (const def of CORE_PLUGINS) {
      const record = store.installedPlugins[def.name]
      const isDisabled = record !== undefined && !record.enabled
      const statusBadge = isDisabled
        ? chalk.yellow('  · disabled')
        : chalk.green('  ✓ enabled')
      console.log(`  ${chalk.bold(def.name.padEnd(24))}${statusBadge}`)
      console.log(chalk.gray(`    ${def.description}`))
    }

    // ── Community plugins ───────────────────────────────────────────────────
    console.log()
    if (communityPlugins.length === 0) {
      console.log(chalk.bold('  Community plugins') + chalk.gray('  (could not fetch — check your connection)'))
      console.log(DIVIDER)
    } else {
      console.log(chalk.bold('  Community plugins') + chalk.gray('  (github.com/VoidenHQ/plugins)'))
      console.log(DIVIDER)
      for (const def of communityPlugins) {
        const installed = store.installedPlugins[def.id]
        let statusBadge: string
        if (!installed) {
          statusBadge = chalk.gray('  not installed')
        } else if (installed.enabled) {
          statusBadge = chalk.green('  ✓ enabled')
        } else {
          statusBadge = chalk.yellow('  · disabled')
        }
        const runnerBadge = hasCommunityRunner(def.id) ? '' : chalk.gray('  [no runner]')
        console.log(
          `  ${chalk.bold(def.id.padEnd(24))}${statusBadge}${runnerBadge}` +
          chalk.gray(`  v${def.version}`) +
          chalk.gray(`  by ${def.author}`)
        )
        console.log(chalk.gray(`    ${def.description}`))
      }
    }

    const knownIds = new Set([
      ...CORE_PLUGINS.map(p => p.name),
      ...communityPlugins.map(p => p.id),
    ])
    const extras = getAllInstalledPlugins().filter(p => !knownIds.has(p.name))
    if (extras.length > 0) {
      console.log()
      console.log(chalk.bold('  Installed (external)'))
      console.log(DIVIDER)
      for (const p of extras) {
        const badge = p.enabled ? chalk.green('  ✓ enabled') : chalk.yellow('  · disabled')
        console.log(`  ${chalk.bold(p.name.padEnd(24))}${badge}`)
      }
    }

    console.log()
  })

program.parse()
