import type { DriftReport } from '../types';

/**
 * Export drift report to GitHub-flavored Markdown
 */
export function exportToMarkdown(report: DriftReport): string {
  const lines: string[] = [];
  const dateStr = new Date(report.timestamp).toISOString();

  lines.push(`# Schema Drift Report`);
  lines.push(`\n**Timestamp**: \`${dateStr}\`  `);
  if (report.requestMethod && report.requestUrl) {
    lines.push(`**Endpoint**: \`${report.requestMethod} ${report.requestUrl}\`  `);
  }
  if (report.statusCode) {
    lines.push(`**Status Code**: \`${report.statusCode}\`  `);
  }
  lines.push(`**Payload Format**: \`${report.format.toUpperCase()}\`\n`);

  if (report.isNewBaseline) {
    lines.push(`> [!NOTE]\n> Initial baseline recorded. No previous schema to compare against.\n`);
    return lines.join('\n');
  }

  // Summary alert
  if (report.hasBreakingChanges) {
    lines.push(
      `> [!WARNING]\n> **BREAKING CHANGES DETECTED**: ${report.summary.breaking} breaking change(s) found in response schema.\n`
    );
  } else if (report.summary.total === 0 || report.summary.breaking === 0 && report.summary.additions === 0) {
    lines.push(`> [!NOTE]\n> **NO SCHEMA DRIFT**: Response structure perfectly matches baseline.\n`);
  } else {
    lines.push(
      `> [!NOTE]\n> **NON-BREAKING EVOLUTION**: ${report.summary.additions} new field(s) added.\n`
    );
  }

  // Summary Table
  lines.push(`### Summary`);
  lines.push(`| Metric | Count |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| 🔴 Breaking Changes | **${report.summary.breaking}** |`);
  lines.push(`| 🟡 Warnings | **${report.summary.warnings}** |`);
  lines.push(`| 🟢 Field Additions | **${report.summary.additions}** |`);
  lines.push(`| ⚪ Ignored Differences | **${report.summary.ignored}** |`);
  lines.push(`| **Total Differences** | **${report.summary.total}** |\n`);

  // Differences Detail Table
  if (report.differences.length > 0) {
    lines.push(`### Structural Differences`);
    lines.push(`| Severity | Change Kind | Field Path | Baseline Type | Current Type | Description |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

    for (const diff of report.differences) {
      const icon = diff.ignored
        ? '⚪ (Ignored)'
        : diff.severity === 'breaking'
        ? '🔴 Breaking'
        : diff.severity === 'warning'
        ? '🟡 Warning'
        : '🟢 Added';

      const path = `\`${diff.path}\``;
      const baseType = diff.baselineType ? `\`${diff.baselineType}\`` : '-';
      const currType = diff.currentType ? `\`${diff.currentType}\`` : '-';
      const desc = diff.ignored
        ? `${diff.description} *(ignored: ${diff.ignoreReason})*`
        : diff.description;

      lines.push(`| ${icon} | \`${diff.kind}\` | ${path} | ${baseType} | ${currType} | ${desc} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Export drift report to formatted JSON string
 */
export function exportToJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Export drift report to clean ASCII text
 */
export function exportToText(report: DriftReport): string {
  const lines: string[] = [];
  lines.push('=====================================================');
  lines.push('               API SCHEMA DRIFT REPORT               ');
  lines.push('=====================================================');
  lines.push(`Timestamp: ${new Date(report.timestamp).toLocaleString()}`);
  if (report.requestMethod && report.requestUrl) {
    lines.push(`Endpoint:  ${report.requestMethod} ${report.requestUrl}`);
  }
  lines.push(`Format:    ${report.format.toUpperCase()}`);
  lines.push('-----------------------------------------------------');

  if (report.isNewBaseline) {
    lines.push('Status: Initial baseline established (no drift).');
    return lines.join('\n');
  }

  lines.push(
    `Summary: ${report.summary.breaking} Breaking | ${report.summary.additions} Additions | ${report.summary.ignored} Ignored`
  );
  lines.push('-----------------------------------------------------');

  if (report.differences.length === 0) {
    lines.push('No structural changes detected.');
  } else {
    for (const diff of report.differences) {
      const prefix = diff.ignored
        ? '[IGNORED]'
        : diff.severity === 'breaking'
        ? '[BREAKING]'
        : '[ADDED]   ';

      lines.push(`${prefix} ${diff.path}`);
      lines.push(`          Type: ${diff.baselineType || 'none'} -> ${diff.currentType || 'none'}`);
      lines.push(`          Info: ${diff.description}`);
    }
  }
  lines.push('=====================================================');
  return lines.join('\n');
}

/**
 * Export drift report to self-contained HTML
 */
export function exportToHtml(report: DriftReport): string {
  const dateStr = new Date(report.timestamp).toLocaleString();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Schema Drift Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    .meta { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
    .badge-breaking { background: #ef444420; color: #f87171; border: 1px solid #ef444450; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .badge-ok { background: #22c55e20; color: #4ade80; border: 1px solid #22c55e50; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 12px; border: 1px solid #334155; }
    th { background: #1e293b; color: #cbd5e1; }
    tr:nth-child(even) { background: #1e293b40; }
    code { font-family: monospace; background: #33415550; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Schema Drift Report</h1>
  <div class="meta">
    ${report.requestMethod ? `<b>${report.requestMethod}</b> ` : ''}${report.requestUrl || ''} &bull; ${dateStr} &bull; Format: ${report.format.toUpperCase()}
  </div>
  <div>
    ${
      report.hasBreakingChanges
        ? `<span class="badge-breaking">⚠️ ${report.summary.breaking} Breaking Changes Detected</span>`
        : `<span class="badge-ok">✓ No Breaking Schema Drift</span>`
    }
  </div>
  <table>
    <thead>
      <tr>
        <th>Severity</th>
        <th>Field Path</th>
        <th>Baseline Type</th>
        <th>Current Type</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      ${report.differences
        .map(
          (d) => `
      <tr>
        <td>${d.ignored ? 'Ignored' : d.severity.toUpperCase()}</td>
        <td><code>${d.path}</code></td>
        <td><code>${d.baselineType || '-'}</code></td>
        <td><code>${d.currentType || '-'}</code></td>
        <td>${d.description}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
</body>
</html>`;
}
