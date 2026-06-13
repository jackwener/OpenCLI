// channel-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'channel-list',
  access: 'read',
  description: 'List channels in the active slock server',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'server', help: 'Override active server (slug or id) for this call' },
  ],
  columns: ['id', 'name', 'topic'],
  func: async (page, kwargs) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: '/channels/',
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((c) => ({
      id: c.id ?? '',
      name: c.name ?? c.slug ?? '',
      topic: c.topic ?? '',
    }));
  },
});
