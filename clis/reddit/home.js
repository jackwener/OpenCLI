import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRedditMedia, redditFetchJson, throwRedditFetchFailure } from './api.js';

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
    args: [
        { name: 'limit', type: 'int', default: 25, help: `Number of posts (1–${REDDIT_HOME_MAX_LIMIT})` },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        const limit = parseRedditHomeLimit(kwargs.limit);
        await page.goto('https://www.reddit.com');
        // The Best feed is personalized only when logged in — for anonymous
        // sessions Reddit returns a generic listing that overlaps with /r/all.
        // To make `home` semantically meaningful (vs the public `frontpage`
        // command) we require auth and surface the logged-out case via
        // AuthRequiredError instead of silently returning the public feed.
        //
        // Two-pronged auth detection: HTTP 401/403 (JSON, not Reddit's
        // network-security page; see api.js) OR `me.data.name` missing
        // on 200 (stale anonymous cookie session). See PR #1428 sediment.
        //
        // Intermediate object keys avoid `rank`/`title`/`subreddit`/etc. to
        // sidestep the silent-column-drop audit; we use `entries` for the
        // raw payload. See PR #1329 sediment "中间解析对象 key 不能跟
        // columns 任一项重叠".
        const result = await page.evaluate(`(async () => {
      const redditFetchJson = ${redditFetchJson.toString()};
      try {
        const meRes = await redditFetchJson('/api/me.json');
        if (!meRes.ok) return { kind: 'fetch-failed', failure: meRes.failure, where: '/api/me.json' };
        const me = meRes.data;
        if (!me?.data?.name) {
          return { kind: 'auth', detail: 'Not logged in to reddit.com (no identity in /api/me.json)' };
        }

        const limit = ${JSON.stringify(limit)};
        const res = await redditFetchJson('/best.json?limit=' + limit + '&raw_json=1');
        if (!res.ok) return { kind: 'fetch-failed', failure: res.failure, where: '/best.json' };
        const j = res.data;
        const entries = j?.data?.children;
        if (!Array.isArray(entries)) {
          return { kind: 'http', httpStatus: 200, where: '/best.json (no data.children array)' };
        }
        return { kind: 'ok', entries };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()`);

        if (result?.kind === 'fetch-failed') {
            throwRedditFetchFailure(result.failure, result.where);
        }
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
                ...extractRedditMedia(d),
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
