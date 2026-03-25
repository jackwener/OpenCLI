import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const connectionsCommand = cli({
  site: 'dory',
  name: 'connections',
  description: 'List all Dory database connections',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['ID', 'Name', 'Engine', 'Host'],
  func: async (page: IPage) => {
    const result = await page.evaluate(`
      (async function() {
        const res = await fetch(window.location.origin + '/api/connection', { credentials: 'include' });
        if (!res.ok) throw new Error('API error ' + res.status);
        const json = await res.json();
        const list = json.data ?? json ?? [];
        return list.map(function(item) {
          // Each item is { connection: {...}, identities: [...], ssh: ... }
          const c = item.connection ?? item;
          return {
            ID: c.id,
            Name: c.name ?? '',
            Engine: c.engine ?? '',
            Host: (c.host ?? '') + (c.port ? ':' + c.port : ''),
          };
        });
      })()
    `);

    if (!result || result.length === 0) {
      return [{ ID: '', Name: 'No connections found', Driver: '', Host: '' }];
    }
    return result;
  },
});
