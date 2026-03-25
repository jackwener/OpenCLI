import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const queryCommand = cli({
  site: 'dory',
  name: 'query',
  description: 'Execute a SQL query and print the results',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'sql', required: true, positional: true, help: 'SQL statement to execute' },
    { name: 'connection', required: true, help: 'Connection name or ID' },
    { name: 'database', required: false, help: 'Database name (optional)' },
  ],
  // No fixed columns — inferred dynamically from query result fields
  func: async (page: IPage, kwargs: any) => {
    const sql = kwargs.sql as string;
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);
    const database = (kwargs.database as string) || undefined;

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

        if (sets.length === 0) {
          return { error: data.session?.errorMessage ?? 'No result sets returned', rows: [] };
        }

        const firstSet = sets[0];
        if (firstSet.status === 'error') {
          return { error: firstSet.errorMessage, rows: [] };
        }

        // Rows may be plain objects already (keyed by column name)
        const rows = allResults[0] ?? [];
        // Normalise: if rows are arrays, zip with column names
        const cols = (firstSet.columns ?? []).map(function(c) { return c.name ?? String(c); });
        const normalised = rows.map(function(row) {
          if (Array.isArray(row)) {
            var obj = {};
            cols.forEach(function(col, i) { obj[col] = row[i]; });
            return obj;
          }
          return row;
        });

        return {
          rows: normalised,
          rowCount: firstSet.rowCount,
          durationMs: firstSet.durationMs,
          sqlOp: firstSet.sqlOp ?? '',
        };
      })(${JSON.stringify(sql)}, ${JSON.stringify(connectionId)}, ${JSON.stringify(database ?? null)})
    `);

    if (result.error) {
      return [{ Error: String(result.error) }];
    }

    if (!result.rows || result.rows.length === 0) {
      return [{
        Status: 'OK',
        Operation: result.sqlOp ?? '',
        RowCount: result.rowCount ?? 0,
        DurationMs: result.durationMs ?? 0,
      }];
    }

    return result.rows;
  },
});
