/**
 * Shared CLI pretty-printing for a single request's RunResult — the
 * per-request "[i/n] file  METHOD url  status  time", --show-req/--show-res
 * detail, and report-entry (assertions/logs/sections) rendering.
 *
 * Lives here (not left private inside index.ts) so both @voiden/runner's
 * own `run`/`mcp serve` CLI and apps/electron's bundled `voiden run` render
 * identical output — one implementation, not two copies that can drift.
 */
import chalk from 'chalk'
import { basename } from 'path'
import type { RunResult, CliReportEntry } from './types.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

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

export function printRequestResult(
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

const DIVIDER = chalk.gray('─'.repeat(64))

export function printRunSummary(
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
