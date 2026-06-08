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
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['userId', 'name', 'kind', 'role'],
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
    // F2-a — qatester live dump: response is `{ agents: [...], humans: [...] }`,
    // NOT a flat array and NOT under `.members`. Combine both lists and tag each
    // row with `kind` so the caller can tell agents from humans. Fall back to
    // the legacy shapes (`.members` / `.data` / bare array) for forward-compat.
    let agents = [], humans = [];
    if (Array.isArray(data)) {
      humans = data;
    } else if (data) {
      agents = Array.isArray(data.agents) ? data.agents : [];
      humans = Array.isArray(data.humans) ? data.humans : [];
      if (!agents.length && !humans.length) {
        const legacy = data.members || data.data || [];
        humans = Array.isArray(legacy) ? legacy : [];
      }
    }
    return [
      ...humans.map((m) => ({
        userId: m.userId ?? m.id ?? '',
        name: m.name ?? m.username ?? m.displayName ?? '',
        kind: 'human',
        role: m.role ?? '',
      })),
      ...agents.map((m) => ({
        userId: m.userId ?? m.id ?? '',
        name: m.name ?? m.username ?? m.displayName ?? '',
        kind: 'agent',
        role: m.status ?? m.activity ?? '',
      })),
    ];
  },
});
