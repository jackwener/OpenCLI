import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const REDDIT_COMMENT_ID_RE = /^[a-z0-9]+$/i;

function normalizeBareCommentId(value) {
    const commentId = String(value || '').trim();
    if (!REDDIT_COMMENT_ID_RE.test(commentId)) {
        throw new ArgumentError(
            'Comment ID must be a Reddit comment id, t1_ fullname, or reddit.com comment URL.',
            'Use a bare comment id like okf3s7u, a fullname like t1_okf3s7u, or a full Reddit comment URL.',
        );
    }
    return commentId.toLowerCase();
}

export function normalizeRedditCommentFullname(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new ArgumentError(
            'Comment ID is required.',
            'Use a bare comment id like okf3s7u, a fullname like t1_okf3s7u, or a full Reddit comment URL.',
        );
    }

    const fullname = raw.match(/^t1_([a-z0-9]+)$/i);
    if (fullname) return `t1_${normalizeBareCommentId(fullname[1])}`;

    if (/^https?:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new ArgumentError(`Invalid Reddit comment URL: ${raw}`);
        }
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || (host !== 'reddit.com' && !host.endsWith('.reddit.com'))) {
            throw new ArgumentError(
                'Comment URL must be an https reddit.com URL.',
                'Use a URL like https://www.reddit.com/r/sub/comments/post/title/okf3s7u/',
            );
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        const commentsIndex = parts.indexOf('comments');
        const commentIndex = commentsIndex + 3;
        if (commentsIndex < 0 || parts.length <= commentIndex) {
            throw new ArgumentError(
                'Comment URL must include the target comment id.',
                'Use a URL like https://www.reddit.com/r/sub/comments/post/title/okf3s7u/',
            );
        }
        if (parts.length !== commentIndex + 1) {
            throw new ArgumentError(
                'Comment URL must end at the target comment id.',
                'Remove extra path segments after the comment id.',
            );
        }
        return `t1_${normalizeBareCommentId(parts[commentIndex])}`;
    }

    if (raw.includes('/') || raw.startsWith('t3_')) {
        throw new ArgumentError(
            'Comment ID must be a Reddit comment id, t1_ fullname, or reddit.com comment URL.',
            'Use a bare comment id like okf3s7u, a fullname like t1_okf3s7u, or a full Reddit comment URL.',
        );
    }

    return `t1_${normalizeBareCommentId(raw)}`;
}

export function requireReplyText(value) {
    const text = String(value || '');
    if (!text.trim()) {
        throw new ArgumentError('Reply text is required.', 'Pass non-empty text to post as the Reddit reply.');
    }
    return text;
}

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
        const fullname = normalizeRedditCommentFullname(kwargs['comment-id']);
        const text = requireReplyText(kwargs.text);
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
        const fullname = ${JSON.stringify(fullname)};
        const text = ${JSON.stringify(text)};

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
        const things = data?.json?.data?.things;
        const created = Array.isArray(things)
          ? things.find((thing) => thing?.kind === 't1' || String(thing?.data?.name || '').startsWith('t1_'))
          : null;
        const createdName = created?.data?.name || (created?.data?.id ? 't1_' + created.data.id : '');
        if (!createdName) {
          return { kind: 'postcondition', detail: 'Reddit comment response did not include a created reply id' };
        }
        return { kind: 'ok', detail: 'Reply posted on ' + fullname + ' as ' + createdName };
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
        if (result?.kind === 'postcondition') {
            throw new CommandExecutionError(result.detail);
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
