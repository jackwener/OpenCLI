// channel-members.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'channel-members',
  access: 'read',
  description: 'List members of a channel',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['userId', 'name', 'role'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildChannelScopedSnippet({
      channelInput: channel,
      method: 'GET',
      pathSuffix: '/members',
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    const arr = Array.isArray(data) ? data : (data.members || data.data || []);
    return arr.map((m) => ({
      userId: m.userId ?? m.id ?? '',
      name: m.name ?? m.username ?? m.displayName ?? '',
      role: m.role ?? '',
    }));
  },
});
