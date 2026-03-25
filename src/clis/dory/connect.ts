import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { resolveConnectionId } from './_shared.js';

export const connectCommand = cli({
  site: 'dory',
  name: 'connect',
  description: 'Navigate to the SQL console for a specific connection',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: true, positional: true, help: 'Connection name or ID' },
  ],
  columns: ['Status', 'URL'],
  func: async (page: IPage, kwargs: any) => {
    const connectionId = await resolveConnectionId(page, kwargs.connection as string);

    // Resolve the organization slug from the current URL
    // URL pattern: /[organization]/...  or just /
    const org = await page.evaluate(`
      (function() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts.length > 0 ? parts[0] : null;
      })()
    `);

    if (!org) {
      // Fallback: use the connections API to find the org from current session
      // Navigate using just the connection ID via the connect API
      const connectResult = await page.evaluate(`
        (async function(connectionId) {
          const res = await fetch('/api/connection/connect', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: connectionId }),
          });
          return res.ok;
        })(${JSON.stringify(connectionId)})
      `);
      return [{ Status: connectResult ? 'Connected' : 'Error', URL: '' }];
    }

    const targetUrl = `/${org}/${connectionId}/sql-console`;
    await page.goto(`http://localhost:3000${targetUrl}`);
    await page.wait(1.5);

    return [{ Status: 'Connected', URL: `http://localhost:3000${targetUrl}` }];
  },
});
