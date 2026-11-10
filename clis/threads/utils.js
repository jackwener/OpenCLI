/**
 * Shared helpers for the read-only Threads (threads.com) adapter.
 *
 * Threads ships the first page of data as Relay JSON inside
 * <script type="application/json"> tags, streams later payloads (for example
 * a post's direct_replies) as additional script tags, and loads further pages
 * through XHR GraphQL responses while scrolling.
 *
 * Posts are read only from the connection that answers the command, never by
 * collecting every post-shaped object:
 *
 *   search   data.searchResults.edges[].node.thread.thread_items[].post
 *   profile  data.mediaData.edges[].node.thread_items[].post
 *   post     data.media (the requested post itself)
 *            data.media.text_post_app_info.direct_replies.edges[].node.posts.edges[].node
 *
 * Anything else under `data` (relatedPosts and other recommendation modules)
 * is ignored by construction. Nodes are deduped by pk and keep the order in
 * which the server delivered them, so top/recent ordering is preserved.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const THREADS_ORIGIN = 'https://www.threads.com';

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
 * Create the accumulator shared by every payload of one page visit.
 * Must stay self-contained: serialized into the page together with ingestDocument.
 */
export function createStore() {
    return { posts: new Map(), pages: {}, seq: 0 };
}

/**
 * Add the posts of one decoded Relay/GraphQL document to `store`.
 * `kind` tags where a post came from: search | profile | main | reply.
 * `store.pages[kind]` remembers the latest page_info of that connection.
 *
 * Must stay self-contained: it is serialized into the page with toString().
 */
export function ingestDocument(doc, store) {
    const isPost = (n) => !!(n && typeof n === 'object' && n.pk && n.code && n.user && n.user.username && 'caption' in n);
    const add = (n, kind, parent) => {
        if (!isPost(n)) return;
        const pk = String(n.pk);
        if (store.posts.has(pk)) return;
        const info = n.text_post_app_info || {};
        store.posts.set(pk, {
            pk,
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
            kind,
            media_id: n.id ? String(n.id) : '',
            parent: parent || '',
            seq: store.seq++,
        });
    };
    const arr = (v) => (Array.isArray(v) ? v : []);
    const page = (kind, conn) => {
        const info = conn && conn.page_info;
        if (info) store.pages[kind] = { hasNext: info.has_next_page === true, cursor: info.end_cursor || '' };
    };
    const read = (data) => {
        if (data.searchResults) {
            for (const edge of arr(data.searchResults.edges)) {
                for (const item of arr(edge && edge.node && edge.node.thread && edge.node.thread.thread_items)) add(item && item.post, 'search');
            }
            page('search', data.searchResults);
        }
        if (data.mediaData) {
            for (const edge of arr(data.mediaData.edges)) {
                for (const item of arr(edge && edge.node && edge.node.thread_items)) add(item && item.post, 'profile');
            }
            page('profile', data.mediaData);
        }
        if (data.media) {
            add(data.media, 'main');
            const replies = data.media.text_post_app_info && data.media.text_post_app_info.direct_replies;
            if (replies) {
                for (const edge of arr(replies.edges)) {
                    for (const e of arr(edge && edge.node && edge.node.posts && edge.node.posts.edges)) add(e && e.node, 'reply', data.media.id ? String(data.media.id) : '');
                }
                page('reply', replies);
            }
        }
    };
    // Relay wraps `data` in require[..][..].__bbox.result; descend through
    // wrappers only, never into a post.
    const walk = (n, depth) => {
        if (!n || typeof n !== 'object' || depth > 40 || isPost(n)) return;
        if (Array.isArray(n)) {
            for (const x of n) walk(x, depth + 1);
            return;
        }
        if (n.data && typeof n.data === 'object' && !Array.isArray(n.data)) read(n.data);
        for (const k of Object.keys(n)) {
            if (k !== 'data') walk(n[k], depth + 1);
        }
    };
    walk(doc, 0);
    return store;
}

/**
 * Decode one script-tag or XHR body. GraphQL responses may carry the
 * `for (;;);` guard and may be newline-delimited JSON chunks.
 * Must stay self-contained: it is serialized into the page with toString().
 */
export function ingestPayloadText(text, store, ingest) {
    if (!text || text.indexOf('"caption"') < 0) return;
    const body = text.replace(/^for \(;;\);/, '');
    for (const chunk of body.split(/\n(?=\{)/)) {
        let parsed;
        try {
            parsed = JSON.parse(chunk);
        } catch {
            continue;
        }
        ingest(parsed, store);
    }
}

/**
 * The posts a command will actually return, before any limit is applied.
 * Shared by the in-page collector (so the limit counts only matching posts)
 * and the row builders. A reply counts only when its parent media id equals
 * the media id of the requested post.
 */
export function selectPosts(posts, { kind, author, withReplies, code } = {}) {
    if (kind === 'profile') {
        const target = String(author || '').toLowerCase();
        return posts.filter((p) => p.kind === 'profile' && p.author.toLowerCase() === target && (withReplies || !p.is_reply));
    }
    if (kind === 'reply') {
        const main = posts.find((p) => p.kind === 'main' && p.code === code);
        if (!main || !main.media_id) return [];
        return posts.filter((p) => p.kind === 'reply' && p.parent === main.media_id && p.pk !== main.pk);
    }
    return posts.filter((p) => p.kind === kind);
}

/**
 * Build the in-page collector. It waits for the Relay payload, then scrolls
 * gently (small steps with jittered pauses, so the site is not hammered) until
 * `limit` posts of `kind` are seen, `scrolls` rounds pass, the connection
 * reports no next page, or three rounds in a row add nothing.
 *
 * `stop` in the result says why it ended: limit | exhausted | stalled | scroll_cap
 * | blocked. `blocked` is rate_limit (HTTP 429) or challenge (checkpoint URL).
 */
export function buildCollectorJs({ limit, scrolls, kind, author = '', withReplies = false, code = '' }) {
    return `
      (async () => {
        const ingestDocument = ${ingestDocument.toString()};
        const ingestPayloadText = ${ingestPayloadText.toString()};
        const selectPosts = ${selectPosts.toString()};
        const createStore = ${createStore.toString()};
        const KIND = ${JSON.stringify(kind)};
        const SELECT = ${JSON.stringify({ kind, author, withReplies, code })};
        const LIMIT = ${Number(limit)};
        const SCROLLS = ${Number(scrolls)};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const store = createStore();
        const ingest = (t) => ingestPayloadText(t, store, ingestDocument);
        const challenged = () => /^\\/(challenge|checkpoint|accounts\\/suspended)/.test(location.pathname);

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

        // Capture pagination responses for this run only: bounded, graphql
        // only, and removed again in the finally block below.
        const MAX_BUF = 50;
        const buf = [];
        const statuses = [];
        const proto = XMLHttpRequest.prototype;
        const origSend = proto.send;
        proto.send = function (...args) {
          this.addEventListener('load', () => {
            try {
              if (!/\\/(api\\/)?graphql/.test(String(this.responseURL || ''))) return;
              statuses.push(this.status);
              if (typeof this.responseText === 'string') {
                buf.push(this.responseText);
                if (buf.length > MAX_BUF) buf.shift();
              }
            } catch {}
          });
          return origSend.apply(this, args);
        };

        const count = () => selectPosts(Array.from(store.posts.values()), SELECT).length;
        const hasNext = () => !!(store.pages[KIND] && store.pages[KIND].hasNext);
        let stale = 0;
        let blocked = challenged() ? 'challenge' : '';
        let stop = 'scroll_cap';
        try {
          for (let i = 0; i < SCROLLS; i++) {
            if (blocked) { stop = 'blocked'; break; }
            if (count() >= LIMIT) { stop = 'limit'; break; }
            if (store.pages[KIND] && !hasNext()) { stop = 'exhausted'; break; }
            if (stale >= 3) { stop = 'stalled'; break; }
            const before = count();
            // One jump to the bottom does not trigger the pagination query;
            // incremental scrolling does.
            for (let k = 0; k < 8; k++) {
              window.scrollBy(0, 500);
              await sleep(450 + Math.random() * 300);
            }
            await sleep(2500 + Math.random() * 1000);
            for (const t of buf.splice(0)) ingest(t);
            ingestScripts();
            if (statuses.splice(0).includes(429)) blocked = 'rate_limit';
            else if (challenged()) blocked = 'challenge';
            stale = count() === before ? stale + 1 : 0;
            if (stale === 1) await sleep(2500);
          }
        } finally {
          proto.send = origSend;
          buf.length = 0;
          statuses.length = 0;
        }
        if (stop === 'scroll_cap' && count() >= LIMIT) stop = 'limit';
        ingestScripts();
        return {
          posts: Array.from(store.posts.values()),
          pages: store.pages,
          stop,
          blocked,
          loginLink: !!document.querySelector('a[href^="/login"]') || location.pathname.startsWith('/login'),
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

export async function collectPosts(page, url, { limit, scrolls, kind, author, withReplies, code }) {
    await navigate(page, url);
    await page.wait(4);
    const result = unwrapEvaluateResult(await page.evaluate(buildCollectorJs({ limit, scrolls, kind, author, withReplies, code })));
    if (!result || typeof result !== 'object' || !Array.isArray(result.posts)) {
        throw new CommandExecutionError('Unexpected Threads collector result shape.');
    }
    return result;
}

/**
 * Validate the shaped rows, not the raw collector output. An empty result is
 * a typed error: login wall, rate limit / challenge, or nothing rendered.
 * Rows that arrived before pagination stopped are returned, with a warning on
 * stderr saying why the list may be shorter than asked.
 */
export function requireRows(rows, result, what, detail = 'No matching posts were rendered; the page markup may have changed.', limit = Infinity, warn = (m) => process.stderr.write(`${m}\n`)) {
    if (rows.length === 0) {
        if (result.loginLink) {
            throw new AuthRequiredError('www.threads.com', `Threads ${what} returned nothing while logged out`);
        }
        if (result.blocked === 'rate_limit') {
            throw new CommandExecutionError(`Threads ${what} was rate limited (HTTP 429)`, 'Wait several minutes before retrying; slow down repeated runs.');
        }
        if (result.blocked === 'challenge') {
            throw new CommandExecutionError(`Threads ${what} hit a login challenge`, 'Open threads.com in the automation browser and complete the challenge, then retry.');
        }
        throw new EmptyResultError(`threads ${what}`, detail);
    }
    const cut = result.blocked === 'rate_limit' ? 'rate limited (HTTP 429)'
        : result.blocked === 'challenge' ? 'interrupted by a login challenge'
        : result.stop === 'stalled' ? 'stopped loading more pages'
        : result.stop === 'scroll_cap' ? 'stopped at the scroll cap'
        : '';
    if (cut && rows.length < limit) {
        warn(`threads ${what}: partial result, ${rows.length} of ${limit} requested; pagination ${cut}.`);
    }
    return rows;
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
    return selectPosts(posts, { kind: 'search' })
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

/**
 * The requested post (matched by shortcode) followed by its direct replies in
 * delivery order. Streamed reply documents carry only the parent's media id,
 * so a reply is accepted only when that id equals the main post's.
 */
export function postRows(posts, code, limit) {
    const main = posts.find((p) => p.kind === 'main' && p.code === code);
    if (!main) return [];
    const replies = selectPosts(posts, { kind: 'reply', code }).slice(0, limit);
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

/** Posts on the profile feed written by `username`, in the order the profile delivered them. */
export function userRows(posts, username, limit, withReplies) {
    return selectPosts(posts, { kind: 'profile', author: username, withReplies })
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
