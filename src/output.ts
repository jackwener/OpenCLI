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

function renderTable(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) { console.log(styleText('dim', '(no data)')); return; }
  const columns = resolveColumns(rows, opts);

  const header = columns.map(c => capitalize(c));
  const table = new Table({
    head: header.map(h => styleText('bold', h)),
    style: { head: [], border: [] },
    wordWrap: true,
    wrapOnWordBoundary: true,
  });

  for (const row of rows) {
    table.push(columns.map(c => {
      const v = (row as Record<string, unknown>)[c];
      return v === null || v === undefined ? '' : String(v);
    }));
  }

  console.log();
  if (opts.title) console.log(styleText('dim', `  ${opts.title}`));
  console.log(table.toString());
  const footer: string[] = [];
  footer.push(`${rows.length} items`);
  if (opts.elapsed !== undefined) footer.push(`${opts.elapsed.toFixed(1)}s`);
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
