#!/usr/bin/env node
import { program } from 'commander'
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { resolve, relative, basename, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import { runVoidFile } from './runner.js'
import { resolveFiles } from './discovery.js'
import { loadEnabledPlugins } from './plugins/loader.js'
import { exportToCsv } from './report/csv.js'
import { sendMailReport } from './report/mail.js'
import { getCorePlugins, findPlugin, hasCoreRunner } from './plugins/registry.js'
import { downloadCoreRunner } from './plugins/loader.js'
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
  setPluginVersion,
  getAllInstalledPlugins,
  readStore,
  STORE_DIR,
} from './plugins/store.js'
import { checkForPluginUpdates, type PluginUpdateInfo } from './plugins/updateCheck.js'
import { getInstalledPluginInfo } from './plugins/versionInfo.js'
import {
  classifyBlockVersion,
  parseVoidFile,
  installMcpIntegration,
  uninstallMcpIntegration,
  getMcpStatus,
  RUNNER_SKILL_MARKDOWN,
} from '@voiden/executors'
import {
  appendSessionResults,
  loadSessionResults,
  clearSession,
} from './session.js'
import type { RunResult, CliReportEntry } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Exit codes — a stable, documented contract CI pipelines can branch on.
//
//   0  success — all requests passed
//   1  one or more requests failed (assertions/errors), or --bail /
//      --fail-on-error triggered — unchanged from prior releases
//   2  the runner could not execute the run at all: bad CLI args/flags,
//      missing files, missing plugins, invalid env — a pipeline/config
//      problem, not an API failure
//
// See CHANGELOG.md and docs.voiden.md/docs/developer-tools/voiden-runner/ci-cd
// ─────────────────────────────────────────────────────────────────────────────
const EXIT_SUCCESS = 0
const EXIT_RUN_FAILURE = 1
const EXIT_USAGE_ERROR = 2

/** JSON output schema version — bump whenever a field is renamed, removed, or
 *  reinterpreted (adding a field is not a breaking change and does not need a bump). */
const JSON_SCHEMA_VERSION = '1'

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

/**
 * Builds the `--json` / `--output-json` payload shape shared by `run` and
 * `report generate`. `schemaVersion` is the stable contract external tooling
 * codes against — see the exit-codes comment above for the versioning rule.
 */
function buildJsonReport(
  results: Array<{ file: string; result: RunResult }>,
  extra: { totalDurationMs?: number; activePlugins?: string[] } = {},
) {
  const passed = results.filter(r => r.result.success).length
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      ...extra,
    },
    requests: results.map(r => ({ file: r.file, ...r.result })),
  }
}

function printRunSummaryJson(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
  activePlugins: string[],
): void {
  const output = buildJsonReport(results, { totalDurationMs: totalMs, activePlugins })
  console.log(JSON.stringify(output, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Changelog — voiden-runner ships its own CHANGELOG.md, versioned and released
// independently of the desktop app's in-app changelog.
// ─────────────────────────────────────────────────────────────────────────────

interface ChangelogEntry {
  version: string
  date?: string
  body: string[]
}

/** Split CHANGELOG.md into per-version entries on "## " headers (newest first, matching file order). */
function parseChangelog(content: string): ChangelogEntry[] {
  const lines = content.split('\n')
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(\S+)(?:\s+-\s+(.+))?$/)
    if (headerMatch) {
      if (current) entries.push(current)
      current = { version: headerMatch[1], date: headerMatch[2]?.trim(), body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) entries.push(current)
  return entries
}

function renderChangelogEntry(entry: ChangelogEntry): void {
  const header = entry.date ? `${entry.version}  ${chalk.gray(entry.date)}` : entry.version
  console.log(chalk.bold.white(`  ${header}`))
  console.log(DIVIDER)
  for (const line of entry.body) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sectionMatch = trimmed.match(/^###\s+(.+)$/)
    if (sectionMatch) {
      console.log()
      console.log(chalk.bold.cyan(`  ${sectionMatch[1]}`))
      continue
    }
    const bulletMatch = trimmed.match(/^-\s+(.+)$/)
    if (bulletMatch) {
      console.log(chalk.gray(`    ·  `) + bulletMatch[1])
      continue
    }
    console.log(`  ${trimmed}`)
  }
  console.log()
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin update notices — surfaced after `run` and `plugin` commands so users
// learn about newer registry versions without having to run `plugin list`.
// ─────────────────────────────────────────────────────────────────────────────

function printUpdateNotice(updates: PluginUpdateInfo[]): void {
  if (updates.length === 0) return
  console.log()
  console.log(chalk.yellow(`  ⬆  ${updates.length} plugin update${updates.length !== 1 ? 's' : ''} available`))
  for (const u of updates) {
    console.log(
      chalk.gray(`     ${chalk.bold(u.id.padEnd(24))} ${u.installedVersion} → ${chalk.green(u.latestVersion)}`)
    )
  }
  console.log(chalk.gray(`     Run: voiden-runner plugin update --all`))
}

/** Best-effort update check — never throws, never blocks command output on failure. */
async function notifyPluginUpdates(): Promise<void> {
  try {
    printUpdateNotice(await checkForPluginUpdates())
  } catch {
    // Informational only — ignore failures (e.g. offline)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project requirements status — scans the files a `run` just processed for
// plugin+version tagged blocks and compares against what's installed, in the
// same style as the update notice above, but against what THIS project
// declares rather than the latest registry release. No lockfile involved —
// re-scans the files live each time, so it's always accurate and never goes
// stale, at the cost of re-parsing on every run (files are already small
// text, so this is cheap). Individual mismatched requests already fail on
// their own (see checkBlockVersions in runner.ts); this is the consolidated,
// deduped-by-plugin view across the whole run, surfaced proactively even for
// files where every other block happened to succeed.
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectRequirementIssue {
  pluginId: string
  requiredVersion: string
  installedVersion?: string
  status: 'not-installed' | 'disabled' | 'version-mismatch'
  files: string[]
}

function scanProjectRequirements(files: string[], cwd: string): ProjectRequirementIssue[] {
  // pluginId → version → files that declared it
  const usages = new Map<string, Map<string, Set<string>>>()
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const block of parseVoidFile(content)) {
      const pluginId = block.attrs?.pluginId
      const pluginVersion = block.attrs?.pluginVersion
      if (!pluginId || !pluginVersion) continue
      if (!usages.has(pluginId)) usages.set(pluginId, new Map())
      const versions = usages.get(pluginId)!
      if (!versions.has(pluginVersion)) versions.set(pluginVersion, new Set())
      versions.get(pluginVersion)!.add(relative(cwd, file))
    }
  }

  const issues: ProjectRequirementIssue[] = []
  for (const [pluginId, versions] of usages) {
    for (const [version, fileSet] of versions) {
      const installed = getInstalledPluginInfo(pluginId)
      const status = classifyBlockVersion({ pluginId, pluginVersion: version, blockType: '' }, installed)
      if (status === 'ok') continue
      issues.push({ pluginId, requiredVersion: version, installedVersion: installed?.version, status, files: [...fileSet] })
    }
  }
  return issues
}

function printProjectStatus(issues: ProjectRequirementIssue[]): void {
  if (issues.length === 0) return
  console.log()
  console.log(chalk.yellow(`  ⚠  ${issues.length} plugin${issues.length !== 1 ? 's' : ''} ${issues.length !== 1 ? "don't" : "doesn't"} match what this project needs`))
  for (const issue of issues) {
    const have =
      issue.status === 'not-installed' ? 'not installed'
      : issue.status === 'disabled' ? 'installed but disabled'
      : `v${issue.installedVersion} installed`
    console.log(chalk.gray(`     ${chalk.bold(issue.pluginId.padEnd(24))} requires v${issue.requiredVersion} — ${have}`))
    console.log(chalk.gray(`       used in: ${issue.files.join(', ')}`))
  }
  console.log(chalk.gray(`     Run: voiden-runner plugin install <name>@<version>`))
}

/** Best-effort — never throws, never blocks command output on failure. */
function notifyProjectStatus(files: string[], cwd: string): void {
  try {
    printProjectStatus(scanProjectRequirements(files, cwd))
  } catch {
    // Informational only
  }
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

// ── voiden-runner changelog ───────────────────────────────────────────────────

program
  .command('changelog [version]')
  .description(
    'Show release notes for voiden-runner — versioned independently of the desktop app\n\n' +
    '  Examples:\n' +
    '    voiden-runner changelog            # full history\n' +
    '    voiden-runner changelog --latest   # most recent release only\n' +
    '    voiden-runner changelog 2.1.0       # a specific version\n'
  )
  .option('--latest', 'Show only the most recent release')
  .action((version: string | undefined, opts: { latest?: boolean }) => {
    const changelogPath = resolve(join(dirname(fileURLToPath(import.meta.url)), '../CHANGELOG.md'))
    if (!existsSync(changelogPath)) {
      console.error(chalk.red('  ✗  No CHANGELOG.md found for this install.'))
      process.exit(EXIT_USAGE_ERROR)
    }

    const entries = parseChangelog(readFileSync(changelogPath, 'utf-8'))
    if (entries.length === 0) {
      console.log(chalk.gray('  Changelog is empty.'))
      return
    }

    let toShow = entries
    if (version) {
      const normalized = version.replace(/^v/, '')
      const match = entries.find(e => e.version.replace(/^v/, '') === normalized)
      if (!match) {
        console.error(chalk.red(`  ✗  No changelog entry found for version "${version}".`))
        console.log(chalk.gray(`     Available: ${entries.map(e => e.version).join(', ')}`))
        process.exit(EXIT_USAGE_ERROR)
      }
      toShow = [match!]
    } else if (opts.latest) {
      toShow = [entries[0]]
    }

    console.log()
    console.log(chalk.bold.white('  voiden-runner changelog'))
    console.log()
    for (const entry of toShow) {
      renderChangelogEntry(entry)
    }
  })

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
        process.exit(EXIT_USAGE_ERROR)
      }
      try {
        Object.assign(env, loadEnvFile(envPath))
      } catch (err: any) {
        console.error(chalk.red(`  ✗  ${err.message}`))
        process.exit(EXIT_USAGE_ERROR)
      }
    }

    // 2. Individual --env-var overrides
    if (opts.envVar && Array.isArray(opts.envVar)) {
      for (const pair of opts.envVar) {
        const eq = pair.indexOf('=')
        if (eq === -1) {
          console.error(chalk.red(`  ✗  Invalid --env-var format: "${pair}" (expected key=value)`))
          process.exit(EXIT_USAGE_ERROR)
        }
        const key = pair.slice(0, eq).trim()
        const val = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (!key) {
          console.error(chalk.red(`  ✗  Invalid --env-var format: "${pair}" (key cannot be empty)`))
          process.exit(EXIT_USAGE_ERROR)
        }
        env[key] = val
      }
    }

    const resolvedFiles = await resolveFiles(paths)

    if (resolvedFiles.length === 0) {
      console.error(chalk.red('No .void files found at the given path(s)'))
      process.exit(EXIT_USAGE_ERROR)
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
        process.exit(EXIT_USAGE_ERROR)
      }
      if (!smtpHost) {
        console.error(chalk.red('  ✗  Mail keys are missing. Please provide SMTP configuration (VOIDEN_SMTP_HOST).'))
        process.exit(EXIT_USAGE_ERROR)
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
      const jsonData = buildJsonReport(allResults, { totalDurationMs: totalMs, activePlugins })
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

    // Surface plugin update / project-requirements notices — skipped in --json mode so output stays machine-readable
    if (!opts.json) {
      await notifyPluginUpdates()
      notifyProjectStatus(resolvedFiles, process.cwd())
    }

    process.exit(shouldFail ? EXIT_RUN_FAILURE : EXIT_SUCCESS)
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
      process.exit(EXIT_USAGE_ERROR)
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
        process.exit(EXIT_USAGE_ERROR)
      }
      const smtpHost = opts.smtpHost || env.VOIDEN_SMTP_HOST
      if (!smtpHost) {
        console.error(chalk.red('  ✗  Mail keys are missing. Please provide SMTP configuration (VOIDEN_SMTP_HOST).'))
        process.exit(EXIT_USAGE_ERROR)
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
      const jsonData = buildJsonReport(results)
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
        process.exit(EXIT_USAGE_ERROR)
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

// Splits a `name` or `name@version` CLI arg. Plugin ids are plain slugs (no
// leading `@`), so splitting on the first `@` is unambiguous.
function parsePluginTarget(raw: string): { name: string; pinVersion?: string } {
  const at = raw.indexOf('@')
  if (at <= 0) return { name: raw }
  return { name: raw.slice(0, at), pinVersion: raw.slice(at + 1) }
}

// ── voiden-runner plugin ──────────────────────────────────────────────────────

const pluginCmd = program
  .command('plugin')
  .description('Manage plugins for .void file execution')

// voiden-runner plugin install [names...] --all
pluginCmd
  .command('install [names...]')
  .description(
    'Install one or more plugins, or all core plugins\n\n' +
    '  --all installs all core plugins only. Community plugins must be installed by name.\n' +
    '  Pin an exact version with name@version (e.g. after `voiden-runner lock`, or to\n' +
    '  match a "Block ... requires plugin X vY" error).\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin install --all\n' +
    '    voiden-runner plugin install voiden-scripting\n' +
    '    voiden-runner plugin install voiden-rest-api@1.4.7\n'
  )
  .option('--all', 'Install all core plugins (community plugins must be installed by name)')
  .action(async (rawNames: string[], opts) => {
    const corePlugins = await getCorePlugins()
    const communityPlugins = await fetchCommunityPlugins()

    const targets: { name: string; pinVersion?: string }[] = opts.all
      ? corePlugins.map(p => ({ name: p.name }))
      : rawNames.map(parsePluginTarget)

    if (targets.length === 0) {
      console.error(chalk.red('Specify plugin name(s) or use --all'))
      console.log(chalk.gray('  Core: ' + corePlugins.map(p => p.name).join(', ')))
      if (communityPlugins.length > 0) {
        console.log(chalk.gray('  Community (install by name): ' + communityPlugins.map(p => p.id).join(', ')))
      }
      process.exit(EXIT_USAGE_ERROR)
    }

    let installedCount = 0
    for (const { name, pinVersion } of targets) {
      const foundCoreDef = await findPlugin(name)
      const foundCommDef = !foundCoreDef ? findCommunityPlugin(name, communityPlugins) : undefined
      if (!foundCoreDef && !foundCommDef) {
        console.log(chalk.yellow(`  ⚠  Unknown plugin "${name}" — skipped`))
        continue
      }
      // A pinned version overrides the registry's "latest" default — this is what
      // makes the fix-it command in version-mismatch errors ("plugin install x@y")
      // actually able to install the exact version a file declares.
      const coreDef = foundCoreDef && pinVersion ? { ...foundCoreDef, version: pinVersion } : foundCoreDef
      const commDef = foundCommDef && pinVersion ? { ...foundCommDef, version: pinVersion } : foundCommDef

      // Core plugins: only download if not already bundled/cached — unless a
      // specific version was pinned, in which case always fetch that version.
      if (coreDef && (pinVersion || !hasCoreRunner(name))) {
        process.stdout.write(`  ↓  Downloading runner for ${chalk.bold(name)} …`)
        try {
          const ok = await downloadCoreRunner(coreDef.name, coreDef.repo, coreDef.runnerAsset, coreDef.version, false)
          process.stdout.write('\r' + ' '.repeat(60) + '\r')
          if (!ok) {
            console.log(chalk.red(`  ✗  No "${coreDef.runnerAsset}" asset in release v${coreDef.version} for "${name}"`))
            continue
          }
        } catch (err: any) {
          process.stdout.write('\r' + chalk.red(`  ✗  Failed to download runner for "${name}": ${err?.message ?? String(err)}\n`))
          continue
        }
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
          setPluginVersion(name, commDef.version)
          process.stdout.write('\r' + ' '.repeat(60) + '\r') // clear the line
        } catch (err: any) {
          process.stdout.write('\r' + chalk.red(`  ✗  Failed to download runner for "${name}": ${err?.message ?? String(err)}\n`))
          continue
        }
      }

      const description = coreDef ? coreDef.description : commDef!.description
      const fresh = installPlugin(name, coreDef?.version ?? commDef?.version)
      if (fresh) {
        console.log(chalk.green(`  ✓  Installed`) + chalk.bold(` ${name}`) + chalk.gray(`  —  ${description}`))
        installedCount++
      } else if (pinVersion) {
        // Re-running install with an explicit pin (e.g. to fix a version-mismatch)
        // should still record the newly-downloaded version even if already "installed".
        setPluginVersion(name, coreDef?.version ?? commDef?.version ?? pinVersion)
        console.log(chalk.green(`  ✓  Installed`) + chalk.bold(` ${name}@${pinVersion}`))
        installedCount++
      } else {
        console.log(chalk.gray(`  ·  Already installed`) + ` ${name}`)
      }
    }

    if (installedCount > 0) {
      console.log()
      console.log(chalk.gray(`  ${installedCount} plugin(s) installed. State saved to ~/.voiden/plugins.json`))
    }

    await notifyPluginUpdates()
  })

// voiden-runner plugin update [names...] --all
pluginCmd
  .command('update [names...]')
  .description(
    'Update installed plugins to the latest registry version\n\n' +
    '  --all updates every installed plugin that has a newer version available.\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin update --all\n' +
    '    voiden-runner plugin update voiden-scripting\n' +
    '    voiden-runner plugin update apyhub-explorer voiden-scripting\n'
  )
  .option('--all', 'Update every installed plugin that has a newer version available')
  .action(async (names: string[], opts) => {
    const updates = await checkForPluginUpdates()
    if (updates.length === 0) {
      console.log(chalk.gray('  All installed plugins are up to date.'))
      return
    }

    const targets: string[] = opts.all ? updates.map(u => u.id) : names
    if (targets.length === 0) {
      console.log(chalk.yellow(`  ${updates.length} update${updates.length !== 1 ? 's' : ''} available — specify plugin name(s) or use --all:`))
      printUpdateNotice(updates)
      return
    }

    const corePlugins = await getCorePlugins()
    const communityPlugins = await fetchCommunityPlugins()

    let updatedCount = 0
    for (const name of targets) {
      const update = updates.find(u => u.id === name)
      if (!update) {
        const known = readStore().installedPlugins[name]
        console.log(known
          ? chalk.gray(`  ·  ${name} is already up to date — skipped`)
          : chalk.yellow(`  ⚠  Plugin "${name}" is not installed — skipped`));
        continue
      }

      process.stdout.write(`  ↓  Updating ${chalk.bold(name)} to v${update.latestVersion} …`)
      try {
        if (update.type === 'core') {
          const def = corePlugins.find(p => p.name === name)
          if (!def) throw new Error('plugin no longer in core registry')
          const ok = await downloadCoreRunner(def.name, def.repo, def.runnerAsset, def.version, false)
          process.stdout.write('\r' + ' '.repeat(60) + '\r')
          if (!ok) {
            console.log(chalk.red(`  ✗  No "${def.runnerAsset}" asset in release v${update.latestVersion} for "${name}"`))
            continue
          }
        } else {
          const def = communityPlugins.find(p => p.id === name)
          if (!def) throw new Error('plugin no longer in community registry')
          const result = await installCommunityRunner(def)
          process.stdout.write('\r' + ' '.repeat(60) + '\r')
          if (result === 'no-runner') {
            console.log(chalk.red(`  ✗  No runner.js in release v${update.latestVersion} for "${name}"`))
            continue
          }
          setPluginVersion(name, update.latestVersion)
        }
        console.log(
          chalk.green(`  ✓  Updated`) + chalk.bold(` ${name}`) +
          chalk.gray(`  ${update.installedVersion} → ${update.latestVersion}`)
        )
        updatedCount++
      } catch (err: any) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r')
        console.log(chalk.red(`  ✗  Failed to update "${name}": ${err?.message ?? String(err)}`))
      }
    }

    if (updatedCount > 0) {
      console.log()
      console.log(chalk.gray(`  ${updatedCount} plugin(s) updated.`))
    }
  })

// voiden-runner plugin uninstall [names...] --all
pluginCmd
  .command('uninstall [names...]')
  .description(
    'Remove one or more installed plugins, or all installed plugins\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin uninstall voiden-scripting\n' +
    '    voiden-runner plugin uninstall apyhub-explorer voiden-scripting\n' +
    '    voiden-runner plugin uninstall --all\n'
  )
  .option('--all', 'Uninstall all installed plugins (core and community)')
  .action(async (names: string[], opts: { all?: boolean }) => {
    // Core plugins are bundled and enabled by default — they may never have
    // an explicit store record even though they're clearly active, so --all
    // (and named uninstalls of a bundled plugin) must include the full core
    // registry, not just names that already happen to have a store record.
    const corePlugins = await getCorePlugins()
    const coreNames = new Set(corePlugins.map(p => p.name))

    const targets: string[] = opts.all
      ? [...new Set([...coreNames, ...getAllInstalledPlugins().map(p => p.name)])]
      : names

    if (targets.length === 0) {
      console.error(chalk.red('  Specify plugin name(s) or use --all'))
      process.exit(EXIT_USAGE_ERROR)
      return
    }

    let removedCount = 0
    for (const name of targets) {
      const removed = uninstallPlugin(name, coreNames.has(name))
      if (removed) {
        console.log(chalk.green(`  ✓  Uninstalled`) + ` ${name}`)
        removedCount++
      } else {
        console.log(chalk.yellow(`  ⚠  Plugin "${name}" is not installed`))
      }
    }

    if (removedCount > 1) {
      console.log()
      console.log(chalk.gray(`  ${removedCount} plugin(s) uninstalled.`))
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
      // Re-enable all explicitly disabled plugins (core + community) — but not
      // uninstalled ones; bringing those back requires an explicit `plugin
      // install`, not a blanket --all enable.
      const disabled = Object.entries(store.installedPlugins)
        .filter(([, r]) => !r.enabled && !r.uninstalled)
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
      process.exit(EXIT_USAGE_ERROR)
    }
    const communityPlugins = await fetchCommunityPlugins()
    const commDef = findCommunityPlugin(name, communityPlugins)
    if (commDef && !hasCommunityRunner(name)) {
      console.log(chalk.red(`  ✗  Cannot enable "${name}" — runner not installed`))
      console.log(chalk.gray(`     Run: voiden-runner plugin install ${name}`))
      process.exit(EXIT_USAGE_ERROR)
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
  .action(async (name: string | undefined, opts: { all?: boolean }) => {
    const corePlugins = await getCorePlugins()
    if (opts.all) {
      // Disable all core plugins
      for (const def of corePlugins) {
        setPluginEnabled(def.name, false)
        console.log(chalk.yellow(`  ·  Disabled`) + ` ${def.name}`)
      }
      // Disable all installed community plugins
      const store = readStore()
      const coreNames = new Set(corePlugins.map(p => p.name))
      const communityNames = Object.keys(store.installedPlugins).filter(n => !coreNames.has(n))
      for (const n of communityNames) {
        setPluginEnabled(n, false)
        console.log(chalk.yellow(`  ·  Disabled`) + ` ${n}`)
      }
      const total = corePlugins.length + communityNames.length
      console.log(chalk.gray(`  ${total} plugin(s) disabled.`))
      return
    }
    if (!name) {
      console.error(chalk.red('  Specify a plugin name or use --all'))
      process.exit(EXIT_USAGE_ERROR)
      return
    }
    setPluginEnabled(name, false)
    console.log(chalk.yellow(`  ·  Disabled`) + ` ${name}`)
    if (await findPlugin(name)) {
      console.log(chalk.gray(`     Core plugin disabled. Re-enable with: voiden-runner plugin enable ${name}`))
    }
  })

// voiden-runner plugin list
pluginCmd
  .command('list')
  .description('List all available and installed plugins')
  .action(async () => {
    const store = readStore()
    const corePlugins = await getCorePlugins()
    const communityPlugins = await fetchCommunityPlugins()

    // Per-plugin "update available" badge — compares the version recorded at
    // install/download time against the registry's current version.
    const updateBadge = (id: string, latestVersion: string): string => {
      const installedVersion = store.installedPlugins[id]?.version
      if (!installedVersion || installedVersion === latestVersion) return ''
      return chalk.yellow(`  ⬆ v${latestVersion} available`)
    }

    console.log()
    console.log(chalk.bold('  Core plugins') + chalk.gray('  (from VoidenHQ/plugin-registry)'))
    console.log(DIVIDER)

    for (const def of corePlugins) {
      const record = store.installedPlugins[def.name]
      let statusBadge: string
      if (record?.uninstalled) {
        statusBadge = chalk.gray('  not installed')
      } else if (record !== undefined && !record.enabled) {
        statusBadge = chalk.yellow('  · disabled')
      } else {
        statusBadge = chalk.green('  ✓ enabled')
      }
      console.log(`  ${chalk.bold(def.name.padEnd(24))}${statusBadge}${updateBadge(def.name, def.version)}`)
      console.log(chalk.gray(`    ${def.description}`))
    }

    // ── Community plugins ───────────────────────────────────────────────────
    console.log()
    if (communityPlugins.length === 0) {
      console.log(chalk.bold('  Community plugins') + chalk.gray('  (could not fetch — check your connection)'))
      console.log(DIVIDER)
    } else {
      console.log(chalk.bold('  Community plugins') + chalk.gray('  (from VoidenHQ/plugin-registry)'))
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
          `  ${chalk.bold(def.id.padEnd(24))}${statusBadge}${runnerBadge}${updateBadge(def.id, def.version)}` +
          chalk.gray(`  v${def.version}`) +
          chalk.gray(`  by ${def.author}`)
        )
        console.log(chalk.gray(`    ${def.description}`))
      }
    }

    const knownIds = new Set([
      ...corePlugins.map(p => p.name),
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

    const updates = await checkForPluginUpdates()
    if (updates.length > 0) {
      console.log()
      console.log(chalk.gray(`  Run: voiden-runner plugin update --all  (${updates.length} update${updates.length !== 1 ? 's' : ''} available)`))
    }

    console.log()
  })

// ── voiden-runner mcp ─────────────────────────────────────────────────────────
//
// Enables the AI-agent loop for CLI-only users (no Voiden app installed):
// registers @voiden/mcp-server with Claude Code / Codex, and installs a
// standalone skill teaching the run/verify/write-back workflow. The Voiden
// app's own Settings toggle does the equivalent for desktop users, reusing
// the same registration helpers from mcpInstall.ts.

function resolveMcpTargets(opts: { claude?: boolean; codex?: boolean }): { claude: boolean; codex: boolean } {
  // Default to both when neither flag is given — a single command should be
  // enough to "just enable this".
  if (!opts.claude && !opts.codex) return { claude: true, codex: true }
  return { claude: Boolean(opts.claude), codex: Boolean(opts.codex) }
}

const mcpCmd = program
  .command('mcp')
  .description('Enable AI-agent integration — registers @voiden/mcp-server and installs a run/verify skill')

mcpCmd
  .command('install')
  .description(
    'Register @voiden/mcp-server with Claude Code and/or Codex, and install a skill teaching the run/verify/write-back loop.\n\n' +
    '  Examples:\n' +
    '    voiden-runner mcp install                                    # both Claude Code and Codex\n' +
    '    voiden-runner mcp install --claude                           # Claude Code only\n' +
    '    voiden-runner mcp install -p ./my-project                    # register against a specific project dir (default: cwd)\n' +
    '    voiden-runner mcp install --local-server ./dist/index.js     # before publishing: point at a local build instead of npx\n'
  )
  .option('--claude', 'Install for Claude Code only')
  .option('--codex', 'Install for Codex only')
  .option('-p, --project <path>', 'Project directory to register the MCP server against', '.')
  .option('--local-server <path>', 'Use `node <path>` instead of `npx -y @voiden/mcp-server` — for testing against a local build before it\'s published')
  .action((opts) => {
    const targets = resolveMcpTargets(opts)
    const serverCommand = opts.localServer
      ? { command: 'node', args: [resolve(opts.localServer), resolve(opts.project)] }
      : undefined
    const installed = installMcpIntegration(opts.project, targets, RUNNER_SKILL_MARKDOWN, serverCommand)
    if (installed.length === 0) {
      console.log(chalk.yellow('  Nothing to install.'))
      return
    }
    console.log()
    for (const target of installed) {
      console.log(chalk.green(`  ✓  ${target === 'claude' ? 'Claude Code' : 'Codex'}`) + chalk.gray(`  —  skill installed, @voiden/mcp-server registered for ${resolve(opts.project)}`))
    }
    if (serverCommand) {
      console.log(chalk.gray(`  Using local build: node ${serverCommand.args[0]}`))
    }
    console.log()
    console.log(chalk.gray('  Restart Claude Code / Codex (or run /mcp) to pick up the new server.'))
  })

mcpCmd
  .command('uninstall')
  .description('Remove the MCP server registration and skill installed by `mcp install`')
  .option('--claude', 'Remove Claude Code integration only')
  .option('--codex', 'Remove Codex integration only')
  .option('-p, --project <path>', 'Project directory to unregister the MCP server from', '.')
  .action((opts) => {
    const targets = resolveMcpTargets(opts)
    const removed = uninstallMcpIntegration(opts.project, targets)
    if (removed.length === 0) {
      console.log(chalk.yellow('  Nothing to remove.'))
      return
    }
    for (const target of removed) {
      console.log(chalk.green(`  ✓  Removed`) + chalk.gray(` ${target === 'claude' ? 'Claude Code' : 'Codex'} integration`))
    }
  })

mcpCmd
  .command('status')
  .description('Show whether the MCP server + skill are installed for this project')
  .option('-p, --project <path>', 'Project directory to check', '.')
  .action((opts) => {
    const status = getMcpStatus(opts.project)
    console.log()
    console.log(chalk.bold('  Claude Code'))
    console.log(`    skill installed:     ${status.claude.skillInstalled ? chalk.green('yes') : chalk.gray('no')}`)
    console.log(`    server registered:   ${status.claude.serverRegistered ? chalk.green('yes') : chalk.gray('no')}`)
    console.log()
    console.log(chalk.bold('  Codex'))
    console.log(`    skill installed:      ${status.codex.skillInstalled ? chalk.green('yes') : chalk.gray('no')}`)
    console.log(`    server registered:   ${status.codex.serverRegistered ? chalk.green('yes') : chalk.gray('no')}`)
    console.log()
  })

program.parse()
