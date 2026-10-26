import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BROWSER_JSON_SNIFF_FN, throwIfLoginWall } from '@jackwener/opencli/utils';
import { readRedditListing, unwrapEvaluateResult } from './listing-result.js';

function decodeHtml(s) {
    if (typeof s !== 'string' || !s) return '';
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/g, "'");
}

function extractRedditMedia(d) {
    const post_hint = d?.post_hint || '';
    const url_overridden_by_dest = d?.url_overridden_by_dest || '';
    const preview_image_url = decodeHtml(d?.preview?.images?.[0]?.source?.url || '');
    const gallery_urls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta) {
        for (const it of items) {
            const m = it && meta[it.media_id];
            const u = m?.s?.u;
            if (u) gallery_urls.push(decodeHtml(u));
        }
    }
    return { post_hint, url_overridden_by_dest, preview_image_url, gallery_urls };
}

cli({
    site: 'reddit',
    name: 'hot',
    access: 'read',
    description: 'Reddit 热门帖子',
    domain: 'www.reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'subreddit', default: '', help: 'Subreddit name (e.g. programming). Empty for frontpage' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for Reddit hot');
        const limit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ArgumentError('Reddit hot limit must be an integer from 1 to 100.');
        const subreddit = String(kwargs.subreddit ?? '').trim();
        const path = (subreddit ? `/r/${encodeURIComponent(subreddit)}/hot.json` : '/hot.json')
            + `?limit=${limit}&raw_json=1`;
        await page.goto('https://www.reddit.com');
        const raw = await page.evaluate(`(async () => {
            ${BROWSER_JSON_SNIFF_FN}
            try {
                const payload = await fetchJsonOrLoginWall(${JSON.stringify(path)}, { credentials: 'include' });
                if (payload?.__loginWall && payload.status === 429) return { kind: 'http', status: 429 };
                if (payload?.__loginWall) return { kind: 'login-wall', sentinel: payload };
                if (payload?.error) return { kind: 'http', status: payload.error };
                if (!Array.isArray(payload?.data?.children)) return { kind: 'malformed', detail: 'payload is missing data.children' };
                return { kind: 'ok', rows: payload.data.children };
            } catch (error) {
                return { kind: 'exception', detail: String(error?.message || error) };
            }
        })()`);
        const result = unwrapEvaluateResult(raw);
        if (result?.kind === 'login-wall') throwIfLoginWall(result.sentinel, { url: path });
        const rows = readRedditListing(result, 'Reddit hot');
        if (!rows.length) throw new EmptyResultError('reddit hot', 'Reddit returned an empty listing for this feed. Try a specific subreddit or try again later.');
        return rows.slice(0, limit).map((child, index) => {
            const item = child?.data;
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CommandExecutionError(`Reddit hot row ${index + 1} was missing data.`);
            return {
                rank: index + 1,
                title: item.title,
                subreddit: item.subreddit_name_prefixed,
                score: item.score,
                comments: item.num_comments,
                author: item.author,
                postId: item.id,
                url: 'https://www.reddit.com' + item.permalink,
                ...extractRedditMedia(item),
            };
        });
    },
});
