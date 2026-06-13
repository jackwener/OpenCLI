// reaction-remove.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'reaction-remove',
  access: 'write',
  description: 'Remove your emoji reaction from a message (DELETE /messages/:id/reactions).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full messageId UUID (short ids rejected)' },
    { name: 'emoji', positional: true, required: true, help: 'The unicode emoji to remove, e.g. 👍' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['messageId', 'emoji', 'result'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.messageId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    const emoji = String(kwargs.emoji ?? '').trim();
    if (!emoji) throw new ArgumentError('emoji required (the unicode emoji to remove)');
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'DELETE',
      path: `/messages/${id}/reactions`,
      body: { emoji },
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    dispatchEvaluateResult(result);
    return [{ messageId: id, emoji, result: 'removed' }];
  },
});
