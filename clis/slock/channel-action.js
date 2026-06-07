// channel-action.js — factory for no-body POST /channels/:id/<verb> ops.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

// join / leave / archive / unarchive resolve a channel then POST a fixed verb
// with no body. join/leave return {ok:true}; archive/unarchive return the
// updated channel (so `id`/`archivedAt` are populated for those).
export function makeChannelActionCommand({ name, verb, resultLabel, description }) {
  cli({
    site: SLOCK_SITE,
    name,
    access: 'write',
    description,
    domain: SLOCK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
      { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
      { name: 'server', help: 'Override active server' },
    ],
    columns: ['channel', 'id', 'archivedAt', 'result'],
    func: async (page, kwargs) => {
      const channel = String(kwargs.channel ?? '').trim();
      if (!channel) throw new ArgumentError('channel required');
      await page.goto(SLOCK_HOME_URL);
      const snippet = buildChannelScopedSnippet({
        channelInput: channel,
        method: 'POST',
        pathSuffix: `/${verb}`,
        serverIdOverride: kwargs.server,
      });
      const result = await page.evaluate(`(async () => { ${snippet} })()`);
      const data = dispatchEvaluateResult(result);
      return [{
        channel,
        id: data?.id ?? '',
        archivedAt: data?.archivedAt ?? null,
        result: resultLabel,
      }];
    },
  });
}
