import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const columnsCommand = cli({
  site: 'dory',
  name: 'columns',
  description: 'List columns for a specific table',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: true, positional: true, help: 'Connection name or ID' },
    { name: 'database', required: true, positional: true, help: 'Database name' },
    { name: 'table', required: true, positional: true, help: 'Table name' },
  ],
  columns: ['Name', 'Type', 'PrimaryKey', 'Default'],
  func: async (page: IPage, kwargs: any) => {
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);
    const database = kwargs.database as string;
    const table = kwargs.table as string;

    const result = await page.evaluate(`
      (async function(connectionId, database, table) {
        const url = '/api/connection/' + encodeURIComponent(connectionId)
          + '/databases/' + encodeURIComponent(database)
          + '/tables/' + encodeURIComponent(table) + '/columns';
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'X-Connection-ID': connectionId },
        });
        if (!res.ok) throw new Error('API error ' + res.status + ': ' + await res.text());
        const json = await res.json();
        const list = json.data ?? json ?? [];
        // TableColumnInfo: { columnName, columnType, defaultExpression, isPrimaryKey, ... }
        return list.map(function(col) {
          return {
            Name: col.columnName ?? col.name ?? String(col),
            Type: col.columnType ?? col.type ?? '',
            PrimaryKey: col.isPrimaryKey ? 'YES' : '',
            Default: col.defaultExpression ?? col.default ?? '',
          };
        });
      })(${JSON.stringify(connectionId)}, ${JSON.stringify(database)}, ${JSON.stringify(table)})
    `);

    if (!result || result.length === 0) {
      return [{ Name: 'No columns found', Type: '', PrimaryKey: '', Default: '' }];
    }
    return result;
  },
});
