// inbox-read-all.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'inbox-read-all',
  access: 'write',
  description: 'Mark the entire inbox as read (POST /channels/inbox/read-all)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['result', 'markedCount'],
  func: async (page, kwargs) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'POST',
      path: '/channels/inbox/read-all',
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    return [{ result: 'read-all', markedCount: data?.markedCount ?? null }];
  },
});
