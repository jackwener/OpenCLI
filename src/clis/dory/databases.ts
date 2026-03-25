import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const databasesCommand = cli({
  site: 'dory',
  name: 'databases',
  description: 'List all databases available for a connection',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: true, positional: true, help: 'Connection name or ID' },
  ],
  columns: ['Name', 'Value'],
  func: async (page: IPage, kwargs: any) => {
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);

    const result = await page.evaluate(`
      (async function(connectionId) {
        const url = '/api/connection/' + encodeURIComponent(connectionId) + '/databases';
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'X-Connection-ID': connectionId },
        });
        if (!res.ok) throw new Error('API error ' + res.status + ': ' + await res.text());
        const json = await res.json();
        const list = json.data ?? json ?? [];
        // DatabaseMeta: { label: string, value: string }
        return list.map(function(db) {
          return {
            Name: db.label ?? db.name ?? String(db),
            Value: db.value ?? '',
          };
        });
      })(${JSON.stringify(connectionId)})
    `);

    if (!result || result.length === 0) {
      return [{ Name: 'No databases found', Value: '' }];
    }
    return result;
  },
});
