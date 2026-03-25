import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const tablePreviewCommand = cli({
  site: 'dory',
  name: 'table-preview',
  description: 'Preview rows from a table',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: true, positional: true, help: 'Connection name or ID' },
    { name: 'database', required: true, positional: true, help: 'Database name' },
    { name: 'table', required: true, positional: true, help: 'Table name' },
    { name: 'limit', required: false, help: 'Max rows to return (default: 50)', default: '50' },
  ],
  columns: ['Row'],
  func: async (page: IPage, kwargs: any) => {
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);
    const database = kwargs.database as string;
    const table = kwargs.table as string;
    const limit = parseInt(kwargs.limit as string, 10) || 50;

    const result = await page.evaluate(`
      (async function(connectionId, database, table, limit) {
        const url = '/api/connection/' + encodeURIComponent(connectionId)
          + '/databases/' + encodeURIComponent(database)
          + '/tables/' + encodeURIComponent(table) + '/preview';
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Connection-ID': connectionId,
          },
          body: JSON.stringify({ database: database, table: table, limit: limit }),
        });
        if (!res.ok) throw new Error('API error ' + res.status + ': ' + await res.text());
        const json = await res.json();
        // Response: { data: { columns: [...], rows: [[...], ...] } }
        const data = json.data ?? json;
        const columns = data.columns ?? data.fields ?? [];
        const rows = data.rows ?? data.data ?? data.results ?? [];
        return { columns: columns, rows: rows };
      })(${JSON.stringify(connectionId)}, ${JSON.stringify(database)}, ${JSON.stringify(table)}, ${limit})
    `);

    if (!result || !result.rows || result.rows.length === 0) {
      return [{ Row: 'No rows found' }];
    }

    const cols: string[] = (result.columns ?? []).map((c: any) => c.name ?? c);

    // Return one row per result, with dynamic column keys
    return result.rows.map((row: any) => {
      if (Array.isArray(row)) {
        const obj: Record<string, unknown> = {};
        cols.forEach((col: string, i: number) => { obj[col] = row[i]; });
        return obj;
      }
      return row;
    });
  },
});
