// dm-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'dm-list',
  access: 'read',
  description: 'List DM channels in the active server (GET /channels/dm)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['channelId', 'peerName', 'peerId', 'createdAt'],
  func: async (page, kwargs) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: '/channels/dm',
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of DM channels, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((c) => ({
      channelId: c.id ?? '',
      peerName: c.peerDisplayName ?? c.peerName ?? c.name ?? '',
      peerId: c.peerId ?? '',
      createdAt: c.createdAt ?? '',
    }));
  },
});
