// nodeseek post — a NodeSeek thread: main body (floor 0) + replies.
//
// NodeSeek server-renders every floor into the post page as `li.content-item`
// (id = floor number, data-comment-id = comment id, .author-name, .post-content,
// <time datetime>). We read them straight off the rendered DOM — this is the
// piece a generic HTML-to-markdown reader can't get (it only captures floor 0).
//
// Floors are paged at ~10 per page. Like weibo/user-posts, this is limit-driven:
// it walks pages only as far as needed to collect `--limit` floors (capped at
// MAX_LIMIT), so a runaway thread can never crawl unbounded.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { ensureNsHome, hasNsSessionCookie, readLimit as readLimitShared, NS_HOME } from './client.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
// Hard backstop on page walks; MAX_LIMIT floors at ~10/page needs ~50 pages.
const PAGE_CAP = 60;

/** Accept "779413", "post-779413-1", or a full post URL -> numeric id. */
function parsePostId(raw) {
    const s = String(raw ?? '').trim();
    // Prefer the post-<id> token; only fall back to a bare number when the whole
    // input is digits — otherwise a /space/<id> or #<n> in a URL wins wrongly.
    const m = s.match(/post-(\d+)/) || (/^\d+$/.test(s) ? [null, s] : null);
    if (!m)
        throw new ArgumentError('nodeseek post', `Cannot parse post id from "${raw}" (give a numeric id or post-xxxxx-1)`);
    return m[1];
}

const readLimit = (value) => readLimitShared(value, { max: MAX_LIMIT, def: DEFAULT_LIMIT, command: 'nodeseek post' });

/** Dedupe by comment id, sort by numeric floor, truncate unless `full`. */
function dedupeAndSort(floors, full) {
    const cap = full ? Infinity : 200;
    const floorNo = (f) => {
        const raw = String(f.floor ?? '').trim();
        const n = raw === '' ? NaN : Number(raw);
        return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    const seen = new Map();
    for (const f of floors) {
        const key = f.comment_id || `${f.floor}:${f.author}`;
        if (!seen.has(key)) seen.set(key, f);
    }
    return [...seen.values()]
        .sort((a, b) => floorNo(a) - floorNo(b))
        .map((f) => ({
            floor: f.floor,
            author: f.author,
            time: f.time,
            content: f.content.length > cap ? f.content.slice(0, cap) + '…' : f.content,
            comment_id: f.comment_id,
        }));
}

/** Scrape the floors rendered on one post page. */
async function scrapePage(page, id, pageNo) {
    await page.goto(`${NS_HOME}/post-${id}-${pageNo}`);
    await page.wait(2);
    return page.evaluate(`(() => {
        const items = [...document.querySelectorAll('li.content-item, .content-item')];
        return items.map((it) => {
            const t = it.querySelector('time');
            return {
                floor: it.getAttribute('id'),
                comment_id: it.getAttribute('data-comment-id'),
                author: (it.querySelector('.author-name')?.textContent || '').trim(),
                time: t ? (t.getAttribute('datetime') || t.textContent.trim()) : '',
                content: (it.querySelector('.post-content')?.textContent || '').replace(/\\s+/g, ' ').trim(),
            };
        }).filter((f) => f.author || f.content);
    })()`);
}

cli({
    site: 'nodeseek',
    name: 'post',
    access: 'read',
    description: 'NodeSeek thread body + comment floors (captures replies, not just the first post)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', positional: true, required: true, help: 'Post id (779413, post-779413-1, or a full link)' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of floors incl. body, paging as needed (1-${MAX_LIMIT})` },
        { name: 'full', type: 'boolean', default: false, help: 'Emit full content (default truncates each floor to 200 chars)' },
    ],
    columns: ['floor', 'author', 'time', 'content', 'comment_id'],
    func: async (page, kwargs) => {
        const id = parsePostId(kwargs.id);
        const limit = readLimit(kwargs.limit);
        await ensureNsHome(page); // pass Cloudflare on home first
        if (!await hasNsSessionCookie(page))
            throw new AuthRequiredError('nodeseek', 'post requires login — run `opencli nodeseek login`');

        const collected = [];
        const seen = new Set();
        let reachedEnd = false;
        let pageNo = 1;
        for (; pageNo <= PAGE_CAP && collected.length < limit; pageNo++) {
            const floors = await scrapePage(page, id, pageNo);
            if (!Array.isArray(floors) || floors.length === 0) { reachedEnd = true; break; }
            let fresh = 0;
            for (const f of floors) {
                const key = f.comment_id || `${f.floor}:${f.author}`;
                if (seen.has(key)) continue;
                seen.add(key);
                collected.push(f);
                fresh++;
            }
            if (fresh === 0) { reachedEnd = true; break; } // page repeated — no new floors
            if (collected.length < limit) // more wanted — show progress for long walks
                log.status(`nodeseek post ${id}: fetched page ${pageNo} (${collected.length} floors)`);
        }
        // Hit the page backstop before satisfying --limit: the thread is longer
        // than this command walks. Tell the user results are truncated.
        if (!reachedEnd && collected.length < limit)
            log.warn(`nodeseek post ${id}: stopped at the ${PAGE_CAP}-page backstop with ${collected.length} floors; the thread is longer than this command fetches`);

        if (collected.length === 0)
            throw new EmptyResultError('nodeseek post', `Post ${id} has no parseable floors (post missing or not accessible)`);
        return dedupeAndSort(collected, !!kwargs.full).slice(0, limit);
    },
});

export const __test__ = { parsePostId, readLimit, dedupeAndSort };
