// channel-info.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'channel-info',
  access: 'read',
  description: 'Show one channel\'s details (GET /channels/:id)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'name', 'type', 'topic', 'joined', 'archivedAt'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildChannelScopedSnippet({
      channelInput: channel,
      method: 'GET',
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const c = dispatchEvaluateResult(result) || {};
    return [{
      id: c.id ?? '',
      name: c.name ?? c.slug ?? '',
      type: c.type ?? '',
      topic: c.topic ?? c.description ?? '',
      joined: c.joined ?? null,
      archivedAt: c.archivedAt ?? null,
    }];
  },
});
