// channel-action.js — factory for no-body POST /channels/:id/<verb> ops.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

// join / leave / archive / unarchive resolve a channel then POST a fixed verb
// with no body. join/leave return {ok:true}; archive/unarchive return the
// updated channel (so `id`/`archivedAt` are populated for those).
// `archivedHint`: when true, an unresolvable #name surfaces a hint that
// archived channels are excluded from the name lookup (use UUID).
export function makeChannelActionCommand({ name, verb, resultLabel, description, archivedHint = false }) {
  cli({
    site: SLOCK_SITE,
    name,
    access: 'write',
    description,
    domain: SLOCK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
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
      let data;
      try {
        data = dispatchEvaluateResult(result);
      } catch (e) {
        // F7 — channelResolveFragment lists active channels only; archived
        // channels are absent from the lookup, so `#name` resolve fails for
        // a channel you're trying to unarchive. UUID still works. Rewrite
        // the bare "no channel matches" message into something actionable.
        if (archivedHint && e instanceof ArgumentError && /no channel matches/.test(e.message)) {
          throw new ArgumentError(
            `${e.message}. Archived channels are excluded from the name lookup; ` +
            `pass the channelId UUID instead (find it in the archived channel's URL in the Slock app).`
          );
        }
        throw e;
      }
      return [{
        channel,
        id: data?.id ?? '',
        archivedAt: data?.archivedAt ?? null,
        result: resultLabel,
      }];
    },
  });
}
