import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const REDDIT_HOME_MAX_LIMIT = 100;

export function parseRedditHomeLimit(raw) {
    if (raw === undefined || raw === null || raw === '') return 25;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > REDDIT_HOME_MAX_LIMIT) {
        throw new ArgumentError(
            `limit must be an integer in [1, ${REDDIT_HOME_MAX_LIMIT}].`,
            `Got: ${raw}`,
        );
    }
    return n;
}

cli({
    site: 'reddit',
    name: 'home',
    access: 'read',
    description: 'Reddit personalized home feed (Best, requires login)',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 25, help: `Number of posts (1–${REDDIT_HOME_MAX_LIMIT})` },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url'],
    func: async (page, kwargs) => {
        const limit = parseRedditHomeLimit(kwargs.limit);
        await page.goto('https://www.reddit.com');
        // The Best feed is personalized only when logged in — for anonymous
        // sessions Reddit returns a generic listing that overlaps with /r/all.
        // To make `home` semantically meaningful (vs the public `frontpage`
        // command) we require auth and surface the logged-out case via
        // AuthRequiredError instead of silently returning the public feed.
        //
        // Two-pronged auth detection: HTTP 401/403 OR `me.data.name` missing
        // on 200 (stale anonymous cookie session). See PR #1428 sediment.
        //
        // Intermediate object keys avoid `rank`/`title`/`subreddit`/etc. to
        // sidestep the silent-column-drop audit; we use `entries` for the
        // raw payload. See PR #1329 sediment "中间解析对象 key 不能跟
        // columns 任一项重叠".
        const result = await page.evaluate(`(async () => {
      try {
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

        const limit = ${JSON.stringify(limit)};
        const res = await fetch('/best.json?limit=' + limit + '&raw_json=1', { credentials: 'include' });
        if (res.status === 401 || res.status === 403) {
          return { kind: 'auth', detail: 'Reddit /best.json returned HTTP ' + res.status };
        }
        if (!res.ok) {
          return { kind: 'http', httpStatus: res.status, where: '/best.json' };
        }
        const j = await res.json();
        const entries = j?.data?.children;
        if (!Array.isArray(entries)) {
          return { kind: 'http', httpStatus: 200, where: '/best.json (no data.children array)' };
        }
        return { kind: 'ok', entries };
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
        if (result?.kind === 'exception') {
            throw new CommandExecutionError(`home failed: ${result.detail}`);
        }
        if (result?.kind !== 'ok') {
            throw new CommandExecutionError(`Unexpected result from reddit home: ${JSON.stringify(result)}`);
        }

        const rows = [];
        const entries = result.entries.slice(0, limit);
        for (let i = 0; i < entries.length; i++) {
            const d = entries[i]?.data;
            if (!d || !d.id) continue;
            rows.push({
                rank: i + 1,
                title: typeof d.title === 'string' ? d.title : null,
                subreddit: typeof d.subreddit_name_prefixed === 'string' ? d.subreddit_name_prefixed : null,
                score: typeof d.score === 'number' ? d.score : null,
                comments: typeof d.num_comments === 'number' ? d.num_comments : null,
                postId: d.id,
                author: typeof d.author === 'string' ? d.author : null,
                url: d.permalink ? 'https://www.reddit.com' + d.permalink : null,
            });
        }
        if (rows.length === 0) {
            if (entries.length > 0) {
                throw new CommandExecutionError('Reddit home feed entries were missing required post id anchors');
            }
            throw new EmptyResultError('Reddit returned no posts in the personalized home feed.');
        }
        return rows;
    },
});
