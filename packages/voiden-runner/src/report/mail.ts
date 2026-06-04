import { createTransport } from 'nodemailer'
import type { RunResult, CliReportEntry } from '../types.js'

export interface MailReportOptions {
  to: string
  from?: string
  subject?: string
  smtpHost: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUser?: string
  smtpPass?: string
  csvPath?: string
  jsonPath?: string
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtMs(ms: number): string {
  if (ms <= 0) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
}

function fmtBytes(bytes: number | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function assertionRows(entries: CliReportEntry[]): string {
  const list = entries.filter(e => e.type === 'assertion')
  if (!list.length) return ''

  const p = list.filter(e => e.passed).length
  const f = list.length - p
  const summaryColor = f > 0 ? '#ee8da0' : '#7fd0b2'

  const rows = list.map(e => {
    const icon  = e.passed ? '&#x2713;' : '&#x2717;'
    const color = e.passed ? '#7fd0b2'  : '#ee8da0'
    let extra = ''
    if (!e.passed && e.actual !== undefined && e.expected !== undefined) {
      extra = ` <span style="color:#67728c">(got ${esc(JSON.stringify(e.actual))}, expected ${esc(e.operator ?? '==')} ${esc(JSON.stringify(e.expected))})</span>`
    }
    return `<div style="padding:3px 0"><span style="color:${color}">${icon}</span>&nbsp;<span style="color:#e8eefc">${esc(e.message)}</span>${extra}</div>`
  }).join('')

  return `
    <div style="padding:8px 16px;border-top:1px solid #18233b;background:#0d1526;font-size:12px">
      <div style="color:${summaryColor};font-weight:600;margin-bottom:4px">
        assertions: ${p} passed${f > 0 ? ` &middot; ${f} failed` : ''}
      </div>
      ${rows}
    </div>`
}

function kvRows(obj: Record<string, string> | undefined): string {
  if (!obj || !Object.keys(obj).length) return ''
  return Object.entries(obj).map(([k, v]) =>
    `<div style="padding:1px 0 1px 12px"><span style="color:#7f8aa3">${esc(k)}:</span>&nbsp;<span style="color:#e8eefc">${esc(v)}</span></div>`
  ).join('')
}

function preBlock(text: string): string {
  const MAX = 2000
  const body = text.length > MAX ? text.slice(0, MAX) + '\n… (truncated)' : text
  return `<pre style="margin:4px 0 0;padding:8px 10px;background:#121c31;border-radius:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;color:#e8eefc;font-family:monospace">${esc(body)}</pre>`
}

function detailsBlock(result: RunResult): string {
  const req: string[] = []
  const res: string[] = []

  if (result.method) req.push(`<div><span style="color:#67728c">method:</span>&nbsp;<span style="color:#d7b56d">${esc(result.method)}</span></div>`)
  if (result.url)    req.push(`<div style="word-break:break-all"><span style="color:#67728c">url:</span>&nbsp;<span style="color:#8fb4ff">${esc(result.url)}</span></div>`)
  if (result.requestHeaders && Object.keys(result.requestHeaders).length) {
    req.push(`<div style="margin-top:8px;color:#67728c">headers:</div>${kvRows(result.requestHeaders)}`)
  }
  if (result.requestBody) {
    req.push(`<div style="margin-top:8px;color:#67728c">body:</div>${preBlock(result.requestBody)}`)
  }

  if (result.status !== undefined) {
    res.push(`<div><span style="color:#67728c">status:</span>&nbsp;<span style="color:${result.success ? '#7fd0b2' : '#ee8da0'}">${esc(result.status)} ${esc(result.statusText ?? '')}</span></div>`)
  }
  if (result.responseHeaders && Object.keys(result.responseHeaders).length) {
    res.push(`<div style="margin-top:8px;color:#67728c">headers:</div>${kvRows(result.responseHeaders)}`)
  }
  if (result.body) {
    res.push(`<div style="margin-top:8px;color:#67728c">body:</div>${preBlock(result.body)}`)
  }

  if (!req.length && !res.length) return ''

  const reqSection = req.length ? `
    <div style="margin-bottom:12px">
      <div style="color:#8fb4ff;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">REQUEST</div>
      ${req.join('')}
    </div>` : ''

  const resSection = res.length ? `
    <div>
      <div style="color:#7dc4e4;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">RESPONSE</div>
      ${res.join('')}
    </div>` : ''

  return `
  <details style="border-top:1px solid #18233b">
    <summary style="padding:10px 16px;cursor:pointer;color:#7f8aa3;font-size:12px;user-select:none;list-style:none">&#x25B8;&nbsp;Request &amp; Response</summary>
    <div style="padding:12px 16px;border-top:1px solid #18233b;background:#0d1526;font-size:12px;line-height:1.7;font-family:monospace">
      ${reqSection}${resSection}
    </div>
  </details>`
}

function resultCard(file: string, result: RunResult): string {
  const ok        = result.success
  const iconColor = ok ? '#7fd0b2' : '#ee8da0'
  const icon      = ok ? '&#x2713;' : '&#x2717;'
  const filename  = file.split('/').pop() ?? file
  const durStr    = result.durationMs > 0 ? fmtMs(result.durationMs) : ''
  const sizeStr   = result.size !== undefined ? ` &middot; ${fmtBytes(result.size)}` : ''

  const methodBadge = result.method
    ? `<span style="background:#18233b;color:#d7b56d;font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;font-family:monospace;margin-right:6px">${esc(result.method)}</span>`
    : ''

  const statusBadge = result.status !== undefined
    ? `<span style="background:${ok ? '#7fd0b215' : '#ee8da015'};color:${iconColor};font-size:11px;font-weight:600;padding:2px 7px;border-radius:3px">${esc(result.status)}</span>`
    : ''

  const errorRow = result.error
    ? `<div style="padding:8px 16px;border-top:1px solid #18233b;background:#ee8da010;color:#ee8da0;font-size:12px;font-family:monospace;word-break:break-all">${esc(result.error)}</div>`
    : ''

  const assertions = result.reportEntries?.length ? assertionRows(result.reportEntries) : ''
  const details    = detailsBlock(result)

  return `
  <div style="background:#101a2d;border:1px solid #18233b;${!ok ? 'border-left:3px solid #ee8da040;' : ''}border-radius:8px;margin-bottom:8px;overflow:hidden">
    <div style="padding:13px 16px;display:flex;align-items:flex-start;gap:12px">
      <span style="color:${iconColor};font-size:16px;font-weight:700;line-height:1.3;flex-shrink:0">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="color:#e8eefc;font-size:14px;font-weight:500;margin-bottom:4px">${esc(filename)}</div>
        <div style="color:#7f8aa3;font-size:12px;word-break:break-all">${methodBadge}${esc(result.url || '—')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;padding-left:12px">
        ${statusBadge ? `<div style="margin-bottom:4px">${statusBadge}</div>` : ''}
        ${durStr ? `<div style="color:#67728c;font-size:11px;white-space:nowrap">${durStr}${sizeStr}</div>` : ''}
      </div>
    </div>
    ${errorRow}${assertions}${details}
  </div>`
}

function buildHtml(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
  attachments: { csv?: string; json?: string } = {},
): string {
  const passed = results.filter(r => r.result.success).length
  const failed = results.length - passed
  const durStr = totalMs > 0 ? ` &middot; ${fmtMs(totalMs)} total` : ''

  const failedCards = results.filter(r => !r.result.success).map(r => resultCard(r.file, r.result)).join('')
  const passedCards = results.filter(r =>  r.result.success).map(r => resultCard(r.file, r.result)).join('')

  const parts: string[] = []
  if (attachments.csv)  parts.push('CSV')
  if (attachments.json) parts.push('JSON')
  const attachNote = parts.length > 0
    ? `Detailed logs attached as <strong>${parts.join(' &amp; ')}</strong>.`
    : 'Run with <code style="background:#121c31;padding:1px 5px;border-radius:3px">--csv</code> or <code style="background:#121c31;padding:1px 5px;border-radius:3px">--output-json</code> to attach detailed logs.'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>voiden report</title>
</head>
<body style="margin:0;padding:32px 20px;background:#0d1526;color:#e8eefc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:720px;margin:0 auto">

  <!-- Header -->
  <div style="margin-bottom:28px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="font-size:18px;font-weight:700;color:#e8eefc;letter-spacing:-0.3px">voiden</span>
      <span style="color:#18233b;font-size:18px">&middot;</span>
      <span style="font-size:14px;color:#7f8aa3;font-weight:500">Test Report</span>
    </div>
    <p style="margin:0;color:#67728c;font-size:13px">${new Date().toUTCString()}${durStr}</p>
  </div>

  <!-- Stats -->
  <div style="background:#101a2d;border:1px solid #18233b;border-radius:10px;padding:22px 28px;margin-bottom:28px">
    <div style="display:flex;gap:40px;flex-wrap:wrap">
      <div>
        <div style="color:#67728c;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Passed</div>
        <div style="font-size:36px;font-weight:700;color:#7fd0b2;line-height:1">${passed}</div>
      </div>
      <div>
        <div style="color:#67728c;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Failed</div>
        <div style="font-size:36px;font-weight:700;color:${failed > 0 ? '#ee8da0' : '#67728c'};line-height:1">${failed}</div>
      </div>
      <div>
        <div style="color:#67728c;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Total</div>
        <div style="font-size:36px;font-weight:700;color:#7f8aa3;line-height:1">${results.length}</div>
      </div>
      ${totalMs > 0 ? `<div>
        <div style="color:#67728c;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Duration</div>
        <div style="font-size:36px;font-weight:700;color:#8fb4ff;line-height:1">${fmtMs(totalMs)}</div>
      </div>` : ''}
    </div>
  </div>

  ${failed > 0 ? `
  <!-- Failed section -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <span style="color:#ee8da0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">&#x2717; Failed</span>
    <span style="background:#ee8da015;color:#ee8da0;font-size:11px;padding:2px 8px;border-radius:10px">${failed}</span>
  </div>
  <div style="margin-bottom:24px">${failedCards}</div>` : ''}

  ${passed > 0 ? `
  <!-- Passed section -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <span style="color:#7fd0b2;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">&#x2713; Passed</span>
    <span style="background:#7fd0b215;color:#7fd0b2;font-size:11px;padding:2px 8px;border-radius:10px">${passed}</span>
  </div>
  <div style="margin-bottom:24px">${passedCards}</div>` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid #18233b;padding-top:18px;text-align:center;color:#67728c;font-size:12px">
    ${attachNote}
  </div>

</div>
</body>
</html>`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendMailReport(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
  opts: MailReportOptions,
): Promise<void> {
  const passed = results.filter(r => r.result.success).length
  const failed = results.length - passed

  const transport = createTransport({
    host:   opts.smtpHost,
    port:   opts.smtpPort ?? (opts.smtpSecure ? 465 : 587),
    secure: opts.smtpSecure ?? false,
    auth:   opts.smtpUser ? { user: opts.smtpUser, pass: opts.smtpPass ?? '' } : undefined,
  })

  const subject = opts.subject
    ?? `voiden: ${passed}/${results.length} passed${failed > 0 ? ` · ${failed} failed` : ' · all passed'}`

  const attachments: Array<{ filename: string; path: string }> = []
  if (opts.csvPath) {
    attachments.push({
      filename: opts.csvPath.split('/').pop() || 'report.csv',
      path: opts.csvPath,
    })
  }
  if (opts.jsonPath) {
    attachments.push({
      filename: opts.jsonPath.split('/').pop() || 'report.json',
      path: opts.jsonPath,
    })
  }

  await transport.sendMail({
    from:        opts.from ?? opts.smtpUser ?? 'voiden-runner',
    to:          opts.to,
    subject,
    html:        buildHtml(results, totalMs, { csv: opts.csvPath, json: opts.jsonPath }),
    attachments,
  })
}
