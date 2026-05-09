import { CommandExecutionError } from '@jackwener/opencli/errors';
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
        if (!page)
            throw new CommandExecutionError('Browser session required');
        await page.goto('https://www.reddit.com');
        const result = await page.evaluate(`(async () => {
      try {
        let commentId = ${JSON.stringify(kwargs['comment-id'])};
        const urlMatch = commentId.match(/\\/comment\\/([a-z0-9]+)/);
        if (urlMatch) commentId = urlMatch[1];
        const fullname = commentId.startsWith('t1_') ? commentId : 't1_' + commentId;

        const text = ${JSON.stringify(kwargs.text)};

        // Get modhash
        const meRes = await fetch('/api/me.json', { credentials: 'include' });
        const me = await meRes.json();
        const modhash = me?.data?.modhash || '';

        const res = await fetch('/api/comment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'parent=' + encodeURIComponent(fullname)
            + '&text=' + encodeURIComponent(text)
            + '&api_type=json'
            + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
        });

        if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };
        const data = await res.json();
        const errors = data?.json?.errors;
        if (errors && errors.length > 0) {
          return { ok: false, message: errors.map(e => e.join(': ')).join('; ') };
        }
        return { ok: true, message: 'Reply posted on ' + fullname };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        return [{ status: result.ok ? 'success' : 'failed', message: result.message }];
    }
});
