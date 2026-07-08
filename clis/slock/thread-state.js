// thread-state.js — factory for the threadChannelId-keyed thread ops.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

// unfollow / done / undone all POST { threadChannelId } to
// /channels/threads/<verb> and differ only by path + result label. (follow is
// different — it is keyed by parentMessageId — so it lives in thread-follow.js.)
export function makeThreadStateCommand({ name, verb, resultLabel, description }) {
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
      { name: 'threadChannelId', positional: true, required: true, help: 'Thread channel UUID (from thread-list / message-read)' },
      { name: 'server', help: 'Override active server' },
    ],
    columns: ['threadChannelId', 'result'],
    func: async (page, kwargs) => {
      const id = String(kwargs.threadChannelId ?? '').trim();
      if (!UUID_RE.test(id)) {
        throw new ArgumentError(`threadChannelId must be a full UUID (got "${id}"). Get it from thread-list or message-read's threadChannelId column.`);
      }
      await page.goto(SLOCK_HOME_URL);
      const snippet = buildFetchSnippet({
        method: 'POST',
        path: `/channels/threads/${verb}`,
        body: { threadChannelId: id },
        serverScoped: true,
        serverIdOverride: kwargs.server,
      });
      const result = await page.evaluate(`(async () => { ${snippet} })()`);
      dispatchEvaluateResult(result);
      return [{ threadChannelId: id, result: resultLabel }];
    },
  });
}
