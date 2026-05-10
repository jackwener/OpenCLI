import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'reply',
    access: 'write',
    description: 'Reply to a Reddit comment',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'comment-id', type: 'string', required: true, positional: true, help: 'Comment ID (e.g. okf3s7u) or fullname (t1_xxx)' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'Reply text' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        await page.goto('https://www.reddit.com');
        // Inside page.evaluate we can't throw typed errors (they don't survive
        // the worker boundary), so we surface a structured `kind` discriminator
        // and re-throw the matching typed error on the Node side. Each kind
        // maps 1:1 to a typed-error class — no silent-sentinel rows on failure.
        //
        // Intermediate object keys deliberately avoid `status` / `message` to
        // sidestep the silent-column-drop audit (columns are ['status',
        // 'message']) — see PR #1329 sediment "中间解析对象 key 不能跟 columns
        // 任一项重叠".
        const result = await page.evaluate(`(async () => {
      try {
        let commentId = ${JSON.stringify(kwargs['comment-id'])};
        const urlMatch = commentId.match(/\\/comment\\/([a-z0-9]+)/);
        if (urlMatch) commentId = urlMatch[1];
        const fullname = commentId.startsWith('t1_') ? commentId : 't1_' + commentId;

        const text = ${JSON.stringify(kwargs.text)};

        // Probe identity + modhash. /api/me.json returns data.name only when
        // logged in — empty modhash alone is not a strong enough auth signal
        // because Reddit sometimes returns 200 with empty modhash for stale
        // anonymous sessions.
        const meRes = await fetch('/api/me.json', { credentials: 'include' });
        if (meRes.status === 401 || meRes.status === 403) {
          return { kind: 'auth', detail: 'Reddit /api/me.json returned HTTP ' + meRes.status };
        }
        if (!meRes.ok) {
          return { kind: 'http', httpStatus: meRes.status, where: '/api/me.json' };
        }
        const me = await meRes.json();
        if (!me?.data?.name) {
          return { kind: 'auth', detail: 'Not logged in to reddit.com (no identity in /api/me.json)' };
        }
        const modhash = me.data.modhash || '';

        const res = await fetch('/api/comment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'parent=' + encodeURIComponent(fullname)
            + '&text=' + encodeURIComponent(text)
            + '&api_type=json'
            + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
        });

        if (res.status === 401 || res.status === 403) {
          return { kind: 'auth', detail: 'Reddit /api/comment returned HTTP ' + res.status };
        }
        if (!res.ok) {
          return { kind: 'http', httpStatus: res.status, where: '/api/comment' };
        }
        const data = await res.json();
        const errors = data?.json?.errors;
        if (errors && errors.length > 0) {
          return { kind: 'reddit-error', detail: errors.map(e => e.join(': ')).join('; ') };
        }
        return { kind: 'ok', detail: 'Reply posted on ' + fullname };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()`);

        if (result?.kind === 'auth') {
            throw new AuthRequiredError('reddit.com', result.detail);
        }
        if (result?.kind === 'http') {
            throw new CommandExecutionError(`HTTP ${result.httpStatus} from ${result.where}`);
        }
        if (result?.kind === 'reddit-error') {
            throw new CommandExecutionError(`Reddit rejected reply: ${result.detail}`);
        }
        if (result?.kind === 'exception') {
            throw new CommandExecutionError(`Reply failed: ${result.detail}`);
        }
        if (result?.kind !== 'ok') {
            throw new CommandExecutionError(`Unexpected result from reddit reply: ${JSON.stringify(result)}`);
        }
        return [{ status: 'success', message: result.detail }];
    },
});
