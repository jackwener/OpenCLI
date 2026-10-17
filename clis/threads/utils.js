/**
 * Shared helpers for the read-only Threads (threads.com) adapter.
 *
 * Threads ships the first page of data as Relay JSON inside
 * <script type="application/json"> tags, streams later payloads (for example
 * a post's direct_replies) as additional script tags, and loads further pages
 * through XHR GraphQL responses while scrolling. The collector walks all of
 * them for objects shaped like a post (pk + code + user.username + caption)
 * and dedupes by pk.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const THREADS_ORIGIN = 'https://www.threads.com';

/** Keys whose subtree holds recommendations rather than the requested content. */
export const RELATED_KEYS = ['relatedPosts'];

export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function parseLimit(value, fallback, { min = 1, max = 100 } = {}) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new ArgumentError(`--limit must be an integer between ${min} and ${max}`);
    }
    return n;
}

/**
 * Walk a decoded Relay/GraphQL payload and add every post-shaped node to
 * `posts` (a Map keyed by pk). Nodes under one of `relatedKeys` are flagged
 * `related`; a later non-related sighting of the same pk wins.
 *
 * Must stay self-contained: it is serialized into the page with toString().
 */
export function extractPosts(root, posts, relatedKeys) {
    const skip = new Set(relatedKeys || []);
    const add = (n, related) => {
        const prev = posts.get(String(n.pk));
        if (prev && (!prev.related || related)) return;
        const info = n.text_post_app_info || {};
        posts.set(String(n.pk), {
            pk: String(n.pk),
            code: n.code,
            author: n.user.username,
            text: (n.caption && n.caption.text) || '',
            likes: n.like_count ?? 0,
            replies: info.direct_reply_count ?? 0,
            reposts: info.repost_count ?? 0,
            quotes: info.quote_count ?? 0,
            is_reply: !!info.is_reply,
            reply_to: (info.reply_to_author && info.reply_to_author.username) || '',
            taken_at: n.taken_at || 0,
            related,
        });
    };
    const walk = (n, depth, related) => {
        if (!n || typeof n !== 'object' || depth > 60) return;
        if (Array.isArray(n)) {
            for (const x of n) walk(x, depth + 1, related);
            return;
        }
        if (n.pk && n.code && n.user && n.user.username && 'caption' in n) add(n, related);
        for (const k of Object.keys(n)) {
            const v = n[k];
            if (v && typeof v === 'object') walk(v, depth + 1, related || skip.has(k));
        }
    };
    walk(root, 0, false);
    return posts;
}

/**
 * Decode one script-tag or XHR body. GraphQL responses may carry the
 * `for (;;);` guard and may be newline-delimited JSON chunks.
 * Must stay self-contained: it is serialized into the page with toString().
 */
export function ingestPayloadText(text, posts, relatedKeys, extract) {
    if (!text || text.indexOf('"caption"') < 0) return;
    const body = text.replace(/^for \(;;\);/, '');
    for (const chunk of body.split(/\n(?=\{)/)) {
        let parsed;
        try {
            parsed = JSON.parse(chunk);
        } catch {
            continue;
        }
        extract(parsed, posts, relatedKeys);
    }
}

/**
 * Build the in-page collector. It waits for the Relay payload, then scrolls
 * gently (small steps with jittered pauses, so the site is not hammered) until
 * `limit` non-related posts are seen, `scrolls` rounds pass, or three rounds
 * in a row add nothing.
 */
export function buildCollectorJs({ limit, scrolls, relatedKeys = RELATED_KEYS }) {
    return `
      (async () => {
        const extractPosts = ${extractPosts.toString()};
        const ingestPayloadText = ${ingestPayloadText.toString()};
        const RELATED = ${JSON.stringify(relatedKeys)};
        const LIMIT = ${Number(limit)};
        const SCROLLS = ${Number(scrolls)};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const posts = new Map();
        const ingest = (t) => ingestPayloadText(t, posts, RELATED, extractPosts);

        const scripts = () => Array.from(document.querySelectorAll('script[type="application/json"]'));
        for (let i = 0; i < 40 && !scripts().some((s) => s.textContent.indexOf('"caption"') >= 0); i++) {
          await sleep(300);
        }
        const seen = new WeakSet();
        const ingestScripts = () => {
          for (const s of scripts()) {
            if (seen.has(s)) continue;
            seen.add(s);
            ingest(s.textContent);
          }
        };
        ingestScripts();

        if (!window.__opencliThreadsHooked) {
          window.__opencliThreadsHooked = true;
          window.__opencliThreadsBuf = [];
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener('load', () => {
              try {
                if (typeof this.responseText === 'string') window.__opencliThreadsBuf.push(this.responseText);
              } catch {}
            });
            return origSend.apply(this, args);
          };
        }

        const countMain = () => Array.from(posts.values()).filter((p) => !p.related).length;
        let stale = 0;
        for (let i = 0; i < SCROLLS && countMain() < LIMIT && stale < 3; i++) {
          const before = countMain();
          // One jump to the bottom does not trigger the pagination query;
          // incremental scrolling does.
          for (let k = 0; k < 8; k++) {
            window.scrollBy(0, 500);
            await sleep(450 + Math.random() * 300);
          }
          await sleep(2500 + Math.random() * 1000);
          for (const t of window.__opencliThreadsBuf.splice(0)) ingest(t);
          ingestScripts();
          stale = countMain() === before ? stale + 1 : 0;
          if (stale === 1) await sleep(2500);
        }
        ingestScripts();
        return {
          posts: Array.from(posts.values()),
          loginLink: !!document.querySelector('a[href^="/login"]'),
        };
      })()
    `;
}

function isNavigationRejected(error) {
    return /Navigation rejected/i.test(String(error?.message || error));
}

/**
 * The browser bridge intermittently rejects navigating a reused automation
 * window. Same recovery as clis/google/images.js: retry once in a fresh
 * window, then fall back to opening the URL in a new tab.
 */
async function navigate(page, url) {
    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) throw error;
    }
    if (typeof page.closeWindow === 'function') {
        await page.closeWindow().catch(() => {});
    }
    try {
        await page.goto(url);
    } catch (error) {
        if (!isNavigationRejected(error)) throw error;
        if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
            const pageId = await page.newTab(url);
            if (pageId) {
                await page.setActivePage(pageId);
                return;
            }
        }
        throw error;
    }
}

export async function collectPosts(page, url, { limit, scrolls }) {
    await navigate(page, url);
    await page.wait(4);
    const result = unwrapEvaluateResult(await page.evaluate(buildCollectorJs({ limit, scrolls })));
    if (!result || typeof result !== 'object' || !Array.isArray(result.posts)) {
        throw new CommandExecutionError('Unexpected Threads collector result shape.');
    }
    return result;
}

/**
 * Validate the shaped rows, not the raw collector output: a payload holding
 * only related posts or other authors' posts still yields no evidence, and
 * must fail as a typed error instead of returning an empty success.
 */
export function requireRows(rows, result, what, detail = 'No matching posts were rendered; the page markup may have changed.') {
    if (rows.length > 0) return rows;
    if (result.loginLink) {
        throw new AuthRequiredError('www.threads.com', `Threads ${what} returned nothing while logged out`);
    }
    throw new EmptyResultError(`threads ${what}`, detail);
}

/** Accept a post URL (threads.com or threads.net) or a bare shortcode. */
export function parsePostTarget(raw) {
    const s = String(raw ?? '').trim();
    const m = s.match(/threads\.(?:com|net)\/@([^/?#]+)\/post\/([A-Za-z0-9_-]+)/);
    if (m) return { url: `${THREADS_ORIGIN}/@${m[1]}/post/${m[2]}`, code: m[2] };
    if (/^[A-Za-z0-9_-]{6,}$/.test(s)) return { url: `${THREADS_ORIGIN}/t/${s}`, code: s };
    throw new ArgumentError('Expected a Threads post URL (https://www.threads.com/@user/post/CODE) or a post shortcode');
}

/** Accept `name`, `@name`, or a profile URL. */
export function parseUsername(raw) {
    const s = String(raw ?? '').trim();
    const name = (s.match(/threads\.(?:com|net)\/@([^/?#]+)/)?.[1] ?? s).replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) throw new ArgumentError(`Invalid Threads username: ${s}`);
    return name;
}

export function searchUrl(query, sort) {
    const filter = sort === 'recent' ? '&filter=recent' : '';
    return `${THREADS_ORIGIN}/search?q=${encodeURIComponent(query)}&serp_type=default${filter}`;
}

export function postUrl(p) {
    return `${THREADS_ORIGIN}/@${p.author}/post/${p.code}`;
}

export function isoDate(ts) {
    return ts ? new Date(ts * 1000).toISOString().replace('.000Z', 'Z') : '';
}

export function oneLine(text, max = 280) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function searchRows(posts, limit) {
    return posts
        .filter((p) => !p.related)
        .slice(0, limit)
        .map((p, i) => ({
            rank: i + 1,
            author: p.author,
            text: oneLine(p.text),
            likes: p.likes,
            replies: p.replies,
            reposts: p.reposts,
            published_at: isoDate(p.taken_at),
            url: postUrl(p),
        }));
}

export function postRows(posts, code, limit) {
    const own = posts.filter((p) => !p.related);
    const main = own.find((p) => p.code === code);
    if (!main) return [];
    const replies = own
        .filter((p) => p.pk !== main.pk && p.is_reply && p.taken_at >= main.taken_at)
        .sort((a, b) => a.taken_at - b.taken_at)
        .slice(0, limit);
    const row = (p, type) => ({
        type,
        author: p.author,
        text: oneLine(p.text, 1000),
        likes: p.likes,
        replies: p.replies,
        published_at: isoDate(p.taken_at),
        url: postUrl(p),
    });
    return [row(main, 'post'), ...replies.map((p) => row(p, p.author === main.author ? 'author-reply' : 'reply'))];
}

export function userRows(posts, username, limit, withReplies) {
    const target = username.toLowerCase();
    return posts
        .filter((p) => !p.related && p.author.toLowerCase() === target && (withReplies || !p.is_reply))
        .sort((a, b) => b.taken_at - a.taken_at)
        .slice(0, limit)
        .map((p, i) => ({
            rank: i + 1,
            author: p.author,
            text: oneLine(p.text),
            likes: p.likes,
            replies: p.replies,
            reposts: p.reposts,
            is_reply: p.is_reply,
            published_at: isoDate(p.taken_at),
            url: postUrl(p),
        }));
}
