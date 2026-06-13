// thread-follow.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

// Follow is keyed by the PARENT MESSAGE (the thread channel is created/looked up
// server-side); unfollow/done/undone are keyed by threadChannelId. See the
// thread-unfollow/-done/-undone commands.
cli({
  site: SLOCK_SITE,
  name: 'thread-follow',
  access: 'write',
  description: 'Follow the thread on a parent message (POST /channels/threads/follow)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'parentMessageId', positional: true, required: true, help: 'Full parent messageId UUID (short ids rejected)' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['parentMessageId', 'threadChannelId', 'result'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.parentMessageId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'POST',
      path: '/channels/threads/follow',
      body: { parentMessageId: id },
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    const threadChannelId = data?.threadChannelId ?? data?.channelId ?? data?.id;
    if (!threadChannelId) {
      throw new CommandExecutionError(`Slock thread-follow succeeded without returning a thread channel id for parent message ${id}.`);
    }
    return [{ parentMessageId: id, threadChannelId, result: 'followed' }];
  },
});
