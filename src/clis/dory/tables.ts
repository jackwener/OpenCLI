import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const tablesCommand = cli({
  site: 'dory',
  name: 'tables',
  description: 'List tables in a database for a connection',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: true, positional: true, help: 'Connection name or ID' },
    { name: 'database', required: true, positional: true, help: 'Database name' },
    { name: 'schema', required: false, help: 'Schema name filter (optional)' },
  ],
  columns: ['Schema', 'Name', 'Value'],
  func: async (page: IPage, kwargs: any) => {
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);
    const database = kwargs.database as string;
    const schema = kwargs.schema as string | undefined;

    const result = await page.evaluate(`
      (async function(connectionId, database, schema) {
        const base = '/api/connection/' + encodeURIComponent(connectionId)
          + '/databases/' + encodeURIComponent(database) + '/tables';
        const url = schema ? base + '?schema=' + encodeURIComponent(schema) : base;
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'X-Connection-ID': connectionId },
        });
        if (!res.ok) throw new Error('API error ' + res.status + ': ' + await res.text());
        const json = await res.json();
        const list = json.data ?? json ?? [];
        // TableMeta: { label: string, value: string, schema?: string, database?: string }
        return list.map(function(t) {
          return {
            Schema: t.schema ?? '',
            Name: t.label ?? t.name ?? String(t),
            Value: t.value ?? '',
          };
        });
      })(${JSON.stringify(connectionId)}, ${JSON.stringify(database)}, ${JSON.stringify(schema ?? null)})
    `);

    if (!result || result.length === 0) {
      return [{ Schema: '', Name: 'No tables found', Value: '' }];
    }
    return result;
  },
});
