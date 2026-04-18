/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 */

import { styleText } from 'node:util';
import Table from 'cli-table3';
import yaml from 'js-yaml';

export interface RenderOptions {
  fmt?: string;
  /** True when the user explicitly passed -f on the command line */
  fmtExplicit?: boolean;
  columns?: string[];
  title?: string;
  elapsed?: number;
  source?: string;
  footerExtra?: string;
}

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [{ value: data }];
}

function resolveColumns(rows: Record<string, unknown>[], opts: RenderOptions): string[] {
  return opts.columns ?? Object.keys(rows[0] ?? {});
}

export function render(data: unknown, opts: RenderOptions = {}): void {
  let fmt = opts.fmt ?? 'table';
  // Non-TTY auto-downgrade only when format was NOT explicitly passed by user.
  if (!opts.fmtExplicit) {
    if (fmt === 'table' && !process.stdout.isTTY) fmt = 'yaml';
  }
  if (data === null || data === undefined) {
    console.log(data);
    return;
  }
  switch (fmt) {
    case 'json': renderJson(data); break;
    case 'plain': renderPlain(data, opts); break;
    case 'md': case 'markdown': renderMarkdown(data, opts); break;
    case 'csv': renderCsv(data, opts); break;
    case 'yaml': case 'yml': renderYaml(data); break;
    default: renderTable(data, opts); break;
  }
}

// ── CJK-aware string width ──

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK Extension B
    (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth Signs
    (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
    (cp >= 0x3000 && cp <= 0x303F) ||   // CJK Symbols
    (cp >= 0x3040 && cp <= 0x309F) ||   // Hiragana
    (cp >= 0x30A0 && cp <= 0x30FF)      // Katakana
  );
}

function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

// ── Table rendering ──

// Fits typical date, status, and ID columns without truncation.
const SHORT_COL_THRESHOLD = 15;

const NUMERIC_RE = /^-?[\d,]+\.?\d*$/;

function renderTable(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) { console.log(styleText('dim', '(no data)')); return; }
  const columns = resolveColumns(rows, opts);

  if (rows.length === 1) {
    renderKeyValue(rows[0], columns, opts);
    return;
  }

  const cells: string[][] = rows.map(row =>
    columns.map(c => {
      const v = (row as Record<string, unknown>)[c];
      return v === null || v === undefined ? '' : String(v);
    }),
  );

  const header = columns.map(c => capitalize(c));
  const colCount = columns.length;

  // Single pass: measure column widths + detect numeric columns
  const colContentWidths = header.map(h => displayWidth(h));
  const numericCounts = new Array<number>(colCount).fill(0);
  const totalCounts = new Array<number>(colCount).fill(0);

  for (const row of cells) {
    for (let ci = 0; ci < colCount; ci++) {
      const w = displayWidth(row[ci]);
      if (w > colContentWidths[ci]) colContentWidths[ci] = w;
      const v = row[ci].trim();
      if (v) {
        totalCounts[ci]++;
        if (NUMERIC_RE.test(v)) numericCounts[ci]++;
      }
    }
  }

  const colAligns: Array<'left' | 'right'> = columns.map((_, ci) =>
    totalCounts[ci] > 0 && numericCounts[ci] / totalCounts[ci] > 0.8 ? 'right' : 'left',
  );

  // Calculate column widths to fit terminal.
  // cli-table3 colWidths includes cell padding (1 space each side).
  const termWidth = process.stdout.columns || 120;
  // Border chars: '│' between every column + edges = colCount + 1
  const borderOverhead = colCount + 1;
  const availableWidth = Math.max(termWidth - borderOverhead, colCount * 5);

  let shortTotal = 0;
  const longIndices: number[] = [];

  for (let i = 0; i < colCount; i++) {
    // +2 for cell padding (1 space each side)
    const padded = colContentWidths[i] + 2;
    if (colContentWidths[i] <= SHORT_COL_THRESHOLD) {
      colContentWidths[i] = padded;
      shortTotal += padded;
    } else {
      longIndices.push(i);
    }
  }

  const remainingWidth = availableWidth - shortTotal;
  if (longIndices.length > 0) {
    const perLong = Math.max(Math.floor(remainingWidth / longIndices.length), 12);
    for (const i of longIndices) {
      colContentWidths[i] = Math.min(colContentWidths[i] + 2, perLong);
    }
  }

  const table = new Table({
    head: header.map(h => styleText('bold', h)),
    style: { head: [], border: [] },
    colWidths: colContentWidths,
    colAligns,
    wordWrap: true,
    wrapOnWordBoundary: true,
  });

  for (const row of cells) {
    table.push(row);
  }

  console.log();
  if (opts.title) console.log(styleText('dim', `  ${opts.title}`));
  console.log(table.toString());
  printFooter(rows.length, opts);
}

function renderKeyValue(row: Record<string, unknown>, columns: string[], opts: RenderOptions): void {
  const entries = columns.map(c => ({
    key: capitalize(c),
    value: row[c] === null || row[c] === undefined ? '' : String(row[c]),
  }));

  const maxKeyWidth = Math.max(...entries.map(e => displayWidth(e.key)));

  console.log();
  if (opts.title) console.log(styleText('dim', `  ${opts.title}`));
  console.log();
  for (const { key, value } of entries) {
    const padding = ' '.repeat(maxKeyWidth - displayWidth(key));
    console.log(`  ${styleText('bold', key)}${padding}  ${value}`);
  }
  console.log();
  printFooter(1, opts);
}

function printFooter(count: number, opts: RenderOptions): void {
  const footer: string[] = [];
  footer.push(`${count} items`);
  if (opts.elapsed) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  console.log(styleText('dim', footer.join(' · ')));
}

function renderJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
function renderPlain(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;

  // Single-row single-field shortcuts for chat-style commands.
  if (rows.length === 1) {
    const row = rows[0];
    const entries = Object.entries(row);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'response' || key === 'content' || key === 'text' || key === 'value') {
        console.log(String(value ?? ''));
        return;
      }
    }
  }

  rows.forEach((row, index) => {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    entries.forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
    if (index < rows.length - 1) console.log('');
  });
}


function renderMarkdown(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  const columns = resolveColumns(rows, opts);
  console.log('| ' + columns.join(' | ') + ' |');
  console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of rows) {
    console.log('| ' + columns.map(c => String((row as Record<string, unknown>)[c] ?? '')).join(' | ') + ' |');
  }
}

function renderCsv(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  const columns = resolveColumns(rows, opts);
  console.log(columns.join(','));
  for (const row of rows) {
    console.log(columns.map(c => {
      const v = String((row as Record<string, unknown>)[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
}

function renderYaml(data: unknown): void {
  console.log(yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
