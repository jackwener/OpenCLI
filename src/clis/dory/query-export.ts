import * as fs from 'node:fs';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

function toCsv(columns: string[], rows: any[]): string {
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row: any) => {
    const values = Array.isArray(row)
      ? row
      : columns.map((c) => row[c]);
    return values.map(escape).join(',');
  });
  return [header, ...body].join('\n');
}

export const queryExportCommand = cli({
  site: 'dory',
  name: 'query-export',
  description: 'Execute a SQL query and export results to a CSV file',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'sql', required: true, positional: true, help: 'SQL statement to execute' },
    { name: 'connection', required: true, help: 'Connection name or ID' },
    { name: 'database', required: false, help: 'Database name (optional)' },
    { name: 'output', required: false, help: 'Output CSV file path (default: /tmp/dory-query.csv)' },
  ],
  columns: ['Status', 'File', 'Rows', 'DurationMs'],
  func: async (page: IPage, kwargs: any) => {
    const sql = kwargs.sql as string;
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);
    const database = (kwargs.database as string) || undefined;
    const outputPath = (kwargs.output as string) || '/tmp/dory-query.csv';

    const result = await page.evaluate(`
      (async function(sql, connectionId, database) {
        const body = { sql: sql, stopOnError: false };
        if (database) body.database = database;

        const res = await fetch('/api/query', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Connection-ID': connectionId,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Query API error ' + res.status + ': ' + await res.text());
        const json = await res.json();
        const data = json.data ?? json;

        const sets = data.queryResultSets ?? [];
        const allResults = data.results ?? [];
        if (sets.length === 0) return { error: data.session?.errorMessage ?? 'No result sets', columns: [], rows: [] };

        const firstSet = sets[0];
        if (firstSet.status === 'error') return { error: firstSet.errorMessage, columns: [], rows: [] };

        const cols = (firstSet.columns ?? []).map(function(c) { return c.name ?? String(c); });
        const rawRows = allResults[0] ?? [];
        const rows = rawRows.map(function(row) {
          if (Array.isArray(row)) {
            var obj = {};
            cols.forEach(function(col, i) { obj[col] = row[i]; });
            return obj;
          }
          return row;
        });
        const columns = rows.length > 0 ? Object.keys(rows[0]) : cols;
        return { columns: columns, rows: rows, rowCount: firstSet.rowCount, durationMs: firstSet.durationMs };
      })(${JSON.stringify(sql)}, ${JSON.stringify(connectionId)}, ${JSON.stringify(database ?? null)})
    `);

    if (result.error) {
      return [{ Status: 'Error', File: '', Rows: 0, DurationMs: 0 }];
    }

    const csv = toCsv(result.columns, result.rows);
    fs.writeFileSync(outputPath, csv, 'utf-8');

    return [{
      Status: 'Success',
      File: outputPath,
      Rows: result.rows.length,
      DurationMs: result.durationMs ?? 0,
    }];
  },
});
