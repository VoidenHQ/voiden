/**
 * Export stitch run results to a styled Excel (.xlsx) workbook.
 *
 * Sheets:
 *  1. Summary    — overall file + assertion stats with percentages
 *  2. <filename> — one sheet per file, one row per request section
 */

import XLSX from 'xlsx-js-style';
import type { StitchRunState, StitchFileResult } from './types';

// ─── Design tokens ────────────────────────────────────────────────────────────

const COLOR = {
  // Brand / primary
  brandDark:   '1A1F2E', // near-black navy — title bg
  brandMid:    '2D3748', // dark slate — section header bg
  brandAccent: '6C63FF', // purple accent — column header bg
  accentLight: 'EDE9FF', // very light purple — alternating rows

  // Status
  passedBg:    'D4EDDA', // soft green bg
  passedFg:    '155724', // dark green text
  failedBg:    'F8D7DA', // soft red bg
  failedFg:    '721C24', // dark red text
  errorBg:     'FFF3CD', // amber
  errorFg:     '856404',
  skippedBg:   'E2E3E5',
  skippedFg:   '383D41',
  runningBg:   'CCE5FF',
  runningFg:   '004085',

  // Neutral
  white:       'FFFFFF',
  headerText:  'FFFFFF',
  labelText:   '4A5568',
  valueText:   '1A202C',
  rowAlt:      'F7F8FC',
  border:      'CBD5E0',
};

// ─── Style helpers ─────────────────────────────────────────────────────────────

type CellStyle = {
  font?: any;
  fill?: any;
  alignment?: any;
  border?: any;
};

function fill(fgColor: string): CellStyle['fill'] {
  return { patternType: 'solid', fgColor: { rgb: fgColor } };
}

function border(color = COLOR.border): CellStyle['border'] {
  const side = { style: 'thin', color: { rgb: color } };
  return { top: side, bottom: side, left: side, right: side };
}

const STYLE = {
  // Title row
  title: {
    font: { bold: true, sz: 14, color: { rgb: COLOR.white }, name: 'Calibri' },
    fill: fill(COLOR.brandDark),
    alignment: { horizontal: 'left', vertical: 'center' },
    border: border(COLOR.brandDark),
  },
  // Section heading inside summary (e.g. "Files", "Assertions")
  sectionHeading: {
    font: { bold: true, sz: 11, color: { rgb: COLOR.white }, name: 'Calibri' },
    fill: fill(COLOR.brandMid),
    alignment: { horizontal: 'left', vertical: 'center' },
    border: border(COLOR.brandMid),
  },
  // Label cell in summary
  label: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.labelText }, name: 'Calibri' },
    fill: fill(COLOR.rowAlt),
    alignment: { horizontal: 'left', vertical: 'center' },
    border: border(),
  },
  // Value cell in summary
  value: {
    font: { sz: 10, color: { rgb: COLOR.valueText }, name: 'Calibri' },
    fill: fill(COLOR.white),
    alignment: { horizontal: 'left', vertical: 'center' },
    border: border(),
  },
  // Percentage cell in summary
  pctGood: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.passedFg }, name: 'Calibri' },
    fill: fill(COLOR.passedBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  pctBad: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.failedFg }, name: 'Calibri' },
    fill: fill(COLOR.failedBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  pctNeutral: {
    font: { sz: 10, color: { rgb: COLOR.labelText }, name: 'Calibri' },
    fill: fill(COLOR.rowAlt),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  // Column header row in detail sheets
  colHeader: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.headerText }, name: 'Calibri' },
    fill: fill(COLOR.brandAccent),
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: border(COLOR.brandAccent),
  },
  // Data cells — base
  dataBase: (altRow: boolean): CellStyle => ({
    font: { sz: 10, color: { rgb: COLOR.valueText }, name: 'Calibri' },
    fill: fill(altRow ? COLOR.accentLight : COLOR.white),
    alignment: { vertical: 'center', wrapText: true },
    border: border(),
  }),
  // Data cells — status-coloured
  dataPassed: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.passedFg }, name: 'Calibri' },
    fill: fill(COLOR.passedBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  dataFailed: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.failedFg }, name: 'Calibri' },
    fill: fill(COLOR.failedBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  dataError: {
    font: { bold: true, sz: 10, color: { rgb: COLOR.errorFg }, name: 'Calibri' },
    fill: fill(COLOR.errorBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  dataSkipped: {
    font: { sz: 10, color: { rgb: COLOR.skippedFg }, name: 'Calibri' },
    fill: fill(COLOR.skippedBg),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  },
  // Status code cell
  statusCode: (altRow: boolean): CellStyle => ({
    font: { bold: true, sz: 10, color: { rgb: COLOR.valueText }, name: 'Calibri' },
    fill: fill(altRow ? COLOR.accentLight : COLOR.white),
    alignment: { horizontal: 'center', vertical: 'center' },
    border: border(),
  }),
};

// ─── Utilities ─────────────────────────────────────────────────────────────────

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function sheetName(fileName: string, usedNames: Set<string>): string {
  let base = fileName.replace(/[:\\/?*\[\]]/g, '_').slice(0, 31);
  if (!usedNames.has(base)) { usedNames.add(base); return base; }
  for (let i = 2; i < 100; i++) {
    const suffix = `(${i})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
  }
  return base;
}

function statusStyle(status: string) {
  switch (status) {
    case 'passed':   return STYLE.dataPassed;
    case 'failed':   return STYLE.dataFailed;
    case 'error':    return STYLE.dataError;
    case 'skipped':  return STYLE.dataSkipped;
    default:         return STYLE.dataBase(false);
  }
}

function pctStyle(label: string, value: string): CellStyle {
  if (value === '—' || value === '0%') return STYLE.pctNeutral;
  if (label.toLowerCase().includes('failed') && value !== '0%') return STYLE.pctBad;
  if (label.toLowerCase().includes('passed') && value !== '0%') return STYLE.pctGood;
  return STYLE.pctNeutral;
}

// ─── Summary sheet ─────────────────────────────────────────────────────────────

function buildSummarySheet(run: StitchRunState): any {
  const s = run.summary;

  // We build a cell-by-cell worksheet
  const ws: any = {};

  let row = 0;

  const set = (r: number, c: number, v: string | number, style: CellStyle) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's', s: style };
  };

  const blankRow = (r: number) => {
    set(r, 0, '', { fill: fill(COLOR.white), border: border() });
    set(r, 1, '', { fill: fill(COLOR.white), border: border() });
    set(r, 2, '', { fill: fill(COLOR.white), border: border() });
  };

  // Title
  set(row, 0, 'Stitch Run Report', STYLE.title);
  set(row, 1, '', STYLE.title);
  set(row, 2, '', STYLE.title);
  row++;

  blankRow(row++);

  // Meta
  set(row, 0, 'Status', STYLE.label);
  set(row, 1, run.status.toUpperCase(), statusStyle(
    run.status === 'completed'
      ? (s.failedFiles + s.errorFiles > 0 ? 'failed' : 'passed')
      : run.status === 'error' ? 'error' : 'skipped',
  ));
  set(row, 2, '', STYLE.value);
  row++;

  set(row, 0, 'Duration', STYLE.label);
  set(row, 1, formatDuration(run.duration), STYLE.value);
  set(row, 2, '', STYLE.value);
  row++;

  blankRow(row++);

  // Files section heading
  set(row, 0, 'Files', STYLE.sectionHeading);
  set(row, 1, '', STYLE.sectionHeading);
  set(row, 2, '', STYLE.sectionHeading);
  row++;

  const fileRows: [string, number, string][] = [
    ['Total',   s.totalFiles,  ''],
    ['Passed',  s.passedFiles, pct(s.passedFiles, s.totalFiles)],
    ['Failed',  s.failedFiles, pct(s.failedFiles, s.totalFiles)],
    ['Errored', s.errorFiles,  pct(s.errorFiles, s.totalFiles)],
    ['Skipped', s.skippedFiles, pct(s.skippedFiles, s.totalFiles)],
  ];

  for (const [label, count, p] of fileRows) {
    set(row, 0, label, STYLE.label);
    set(row, 1, count, STYLE.value);
    set(row, 2, p || '', p ? pctStyle(label, p) : STYLE.pctNeutral);
    row++;
  }

  blankRow(row++);

  // Assertions section heading
  set(row, 0, 'Assertions', STYLE.sectionHeading);
  set(row, 1, '', STYLE.sectionHeading);
  set(row, 2, '', STYLE.sectionHeading);
  row++;

  const assertRows: [string, number, string][] = [
    ['Total',  s.totalAssertions,  ''],
    ['Passed', s.passedAssertions, pct(s.passedAssertions, s.totalAssertions)],
    ['Failed', s.failedAssertions, pct(s.failedAssertions, s.totalAssertions)],
  ];

  for (const [label, count, p] of assertRows) {
    set(row, 0, label, STYLE.label);
    set(row, 1, count, STYLE.value);
    set(row, 2, p || '', p ? pctStyle(label, p) : STYLE.pctNeutral);
    row++;
  }

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: 2 } });
  ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 10 }];
  ws['!rows'] = Array.from({ length: row }, (_, i) => ({ hpt: i === 0 ? 26 : 18 }));

  // Merge title across 3 columns
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];

  return ws;
}

// Column widths (wch) for the detail sheet — keep in sync with ws['!cols']
const DETAIL_COL_WIDTHS = [22, 8, 38, 12, 10, 11, 11, 10, 11, 10, 38, 28, 46, 38, 46];

/**
 * Estimate row height in points by finding the tallest cell.
 * For each string value we count explicit newlines AND estimate wrapped lines
 * based on how many characters fit in that column's width.
 * 1 line ≈ 14pt for Calibri 10pt; min 20pt, cap at 400pt.
 */
function estimateRowHeight(values: (string | number)[]): number {
  const LINE_HEIGHT_PT = 14;
  const MIN_PT = 20;
  const MAX_PT = 400;

  let maxLines = 1;

  values.forEach((v, i) => {
    if (typeof v !== 'string' || !v) return;
    const colWidth = DETAIL_COL_WIDTHS[i] ?? 20;
    const segments = v.split('\n');
    let lines = 0;
    for (const seg of segments) {
      // Each segment wraps based on column width (1 wch ≈ 1 char at 10pt)
      lines += Math.max(1, Math.ceil(seg.length / colWidth));
    }
    if (lines > maxLines) maxLines = lines;
  });

  return Math.min(MAX_PT, Math.max(MIN_PT, maxLines * LINE_HEIGHT_PT));
}

// ─── File detail sheet ─────────────────────────────────────────────────────────

function buildFileDetailSheet(file: StitchFileResult): any {
  const HEADERS = [
    'Section',
    'Method',
    'URL',
    'Status Code',
    'Duration',
    'Assertions\nTotal',
    'Assertions\nPassed',
    'Passed %',
    'Assertions\nFailed',
    'Failed %',
    'Assertion Details',
    'Error',
    'Request',
    'Response Headers',
    'Response Body',
  ];

  const ws: any = {};
  const totalCols = HEADERS.length;

  // Header row (row 0)
  HEADERS.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = {
      v: h, t: 's', s: STYLE.colHeader,
    };
  });

  // Data rows
  file.sections.forEach((s, rowIdx) => {
    const r = rowIdx + 1;
    const alt = rowIdx % 2 === 1;
    const base = STYLE.dataBase(alt);

    const assertionDetails = s.assertions.results
      .map((a) => {
        const desc = a.description || (a.operator ? `${a.operator} ${a.expected ?? ''}` : 'Assertion');
        return a.passed ? `✓ ${desc}` : `✗ ${desc}${a.error ? ` (${a.error})` : ''}`;
      })
      .join('\n');

    const reqHeaderLines =
      s.requestInfo?.headers
        ?.map((h) => `${(h as any).key || ''}: ${(h as any).value || ''}`)
        .filter(Boolean)
        .join('\n') ?? '';
    const reqBody = s.requestInfo?.body ?? '';
    const requestCell = [
      reqHeaderLines || null,
      reqBody ? `Body:\n${reqBody}` : null,
    ].filter(Boolean).join('\n\n');

    const resHeaderLines =
      s.responseInfo?.headers
        ?.map((h) => `${(h as any).key || ''}: ${(h as any).value || ''}`)
        .filter(Boolean)
        .join('\n') ?? '';

    const passedPct = pct(s.assertions.passed, s.assertions.total);
    const failedPct = pct(s.assertions.failed, s.assertions.total);

    const cols: { v: string | number; s: CellStyle }[] = [
      { v: s.sectionLabel ?? `Section ${s.sectionIndex + 1}`,  s: { ...base, font: { ...base.font, bold: true } } },
      { v: s.requestInfo?.method ?? '',   s: { ...base, alignment: { horizontal: 'center', vertical: 'center' } } },
      { v: s.requestInfo?.url ?? '',      s: base },
      { v: s.status != null ? s.status : '', s: STYLE.statusCode(alt) },
      { v: formatDuration(s.duration),    s: { ...base, alignment: { horizontal: 'center', vertical: 'center' } } },
      { v: s.assertions.total,            s: { ...base, alignment: { horizontal: 'center', vertical: 'center' } } },
      { v: s.assertions.passed,           s: { ...base, alignment: { horizontal: 'center', vertical: 'center' } } },
      { v: passedPct,                     s: s.assertions.total > 0 ? pctStyle('passed', passedPct) === STYLE.pctGood ? STYLE.pctGood : STYLE.pctNeutral : STYLE.pctNeutral },
      { v: s.assertions.failed,           s: { ...base, alignment: { horizontal: 'center', vertical: 'center' } } },
      { v: failedPct,                     s: s.assertions.failed > 0 ? STYLE.pctBad : STYLE.pctNeutral },
      { v: assertionDetails,              s: base },
      { v: s.error ?? '',                 s: s.error ? STYLE.dataError : base },
      { v: requestCell,                   s: base },
      { v: resHeaderLines,                s: base },
      { v: s.responseInfo?.body ?? '',    s: base },
    ];

    cols.forEach(({ v, s: style }, c) => {
      ws[XLSX.utils.encode_cell({ r, c })] = {
        v, t: typeof v === 'number' ? 'n' : 's', s: style,
      };
    });
  });

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: file.sections.length, c: totalCols - 1 },
  });

  ws['!cols'] = [
    { wch: 22 }, // Section
    { wch: 8 },  // Method
    { wch: 38 }, // URL
    { wch: 12 }, // Status Code
    { wch: 10 }, // Duration
    { wch: 11 }, // Assertions Total
    { wch: 11 }, // Assertions Passed
    { wch: 10 }, // Passed %
    { wch: 11 }, // Assertions Failed
    { wch: 10 }, // Failed %
    { wch: 38 }, // Assertion Details
    { wch: 28 }, // Error
    { wch: 46 }, // Request
    { wch: 38 }, // Response Headers
    { wch: 46 }, // Response Body
  ];

  // Row heights: header taller, data rows sized to content
  ws['!rows'] = [
    { hpt: 32 },
    ...file.sections.map((_s, rowIdx) => {
      const values = Array.from({ length: DETAIL_COL_WIDTHS.length }, (_, c) =>
        ws[XLSX.utils.encode_cell({ r: rowIdx + 1, c })]?.v ?? ''
      );
      return { hpt: estimateRowHeight(values) };
    }),
  ];

  return ws;
}

// ─── Entry point ───────────────────────────────────────────────────────────────

export function exportStitchToExcel(run: StitchRunState): void {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  XLSX.utils.book_append_sheet(wb, buildSummarySheet(run), 'Summary');
  usedNames.add('Summary');

  for (const file of run.files) {
    if (file.sections.length === 0) continue;
    const name = sheetName(file.fileName, usedNames);
    XLSX.utils.book_append_sheet(wb, buildFileDetailSheet(file), name);
  }

  const date = new Date().toISOString().slice(0, 10);
  const buf: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stitch-report-${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
