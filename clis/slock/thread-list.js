// thread-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'thread-list',
  access: 'read',
  description: 'List followed threads in the active server (GET /channels/threads/followed)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['threadChannelId', 'parentMessageId', 'parentChannelName', 'unreadCount', 'replyCount', 'lastReplyAt'],
  func: async (page, kwargs) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: '/channels/threads/followed',
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    const threads = Array.isArray(data) ? data : (data.threads || []);
    if (!Array.isArray(threads)) {
      throw new CommandExecutionError(`expected threads array, got ${typeof threads} (contract drift?)`);
    }
    return threads.map((t) => ({
      threadChannelId: t.threadChannelId ?? t.id ?? '',
      parentMessageId: t.parentMessageId ?? '',
      parentChannelName: t.parentChannelName ?? '',
      unreadCount: typeof t.unreadCount === 'number' ? t.unreadCount : 0,
      replyCount: typeof t.replyCount === 'number' ? t.replyCount : null,
      lastReplyAt: t.lastReplyAt ?? null,
    }));
  },
});
