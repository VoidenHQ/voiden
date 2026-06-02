import { writeFileSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import type { RunResult, CliReportEntry } from '../types.js'

function resolveOutputPath(input: string): string {
  const abs = resolve(input)
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return join(abs, `voiden-report-${ts}.csv`)
  }
  return abs
}

function cell(val: unknown): string {
  if (val === undefined || val === null) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function headersToString(headers?: Record<string, string>): string {
  if (!headers) return ''
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function assertionSummary(entries?: CliReportEntry[]): { passed: number; failed: number; detail: string } {
  const assertions = (entries ?? []).filter(e => e.type === 'assertion')
  const passed = assertions.filter(e => e.type === 'assertion' && e.passed).length
  const failed = assertions.length - passed
  const detail = assertions
    .map(e => e.type === 'assertion' ? `${e.passed ? 'PASS' : 'FAIL'}: ${e.message}` : '')
    .join('\n')
  return { passed, failed, detail }
}

const COLUMNS = [
  'File',
  'Protocol', 'Method', 'URL',
  'Success', 'Status', 'StatusText',
  'DurationMs', 'SizeBytes', 'Error',
  'RequestHeaders', 'RequestBody',
  'ResponseHeaders', 'ResponseBody',
  'AssertionsPassed', 'AssertionsFailed', 'AssertionDetail',
]

export function exportToCsv(
  results: Array<{ file: string; result: RunResult }>,
  outputPath: string,
): string {
  outputPath = resolveOutputPath(outputPath)
  const rows: string[] = [COLUMNS.join(',')]

  for (const { file, result } of results) {
    const { passed, failed, detail } = assertionSummary(result.reportEntries)
    rows.push([
      file,
      result.protocol,
      result.method ?? '',
      result.url,
      result.success ? 'true' : 'false',
      String(result.status ?? ''),
      result.statusText ?? '',
      String(result.durationMs),
      String(result.size ?? ''),
      result.error ?? '',
      headersToString(result.requestHeaders),
      result.requestBody ?? '',
      headersToString(result.responseHeaders),
      result.body ?? '',
      String(passed),
      String(failed),
      detail,
    ].map(cell).join(','))
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, rows.join('\n') + '\n', 'utf-8')
  return outputPath
}
