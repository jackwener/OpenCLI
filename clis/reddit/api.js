// Shared Reddit JSON fetch path. Every read command fetches Reddit's `.json`
// endpoints from inside the logged-in page, and Reddit answers those requests
// with several different non-JSON pages that must not be confused:
//   - its "You've been blocked by network security" page (HTTP 403, HTML),
//     which is applied per endpoint and network and is not fixed by logging in
//     again (#2720, #2771);
//   - a rate-limit response (HTTP 429);
//   - other HTML (login / challenge pages).
// `redditFetchJson` runs in the page (embed it with `.toString()`; it must stay
// self-contained) and returns `{ ok: true, data }` or `{ ok: false, failure }`.
// `throwRedditFetchFailure` turns a failure into a typed error on the Node side.
// The post-media helpers below are shared by the listing commands.
import { AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, EXIT_CODES } from '@jackwener/opencli/errors';
import { throwIfLoginWall } from '@jackwener/opencli/utils';

export async function redditFetchJson(path, init) {
    const response = await fetch(path, { credentials: 'include', ...(init || {}) });
    const contentType = (response.headers && response.headers.get('content-type')) || '';
    const text = await response.text();
    const status = response.status;
    const url = response.url || path;
    const trimmed = text.replace(/^\s+/, '');
    const isHtml = /text\/html/i.test(contentType) || trimmed.startsWith('<');
    if (isHtml && /blocked by network security/i.test(text)) {
        return { ok: false, failure: { reason: 'blocked', status, url } };
    }
    if (status === 429) return { ok: false, failure: { reason: 'rate-limited', status, url } };
    if (isHtml) {
        return { ok: false, failure: { reason: 'html', status, url, contentType, bodyPreview: trimmed.slice(0, 100) } };
    }
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        if (!response.ok) return { ok: false, failure: { reason: 'http', status, url } };
        return { ok: false, failure: { reason: 'malformed', status, url, detail: String(error && error.message || error) } };
    }
    if (!response.ok) {
        const apiReason = data && typeof data.reason === 'string' ? data.reason : '';
        return { ok: false, failure: { reason: 'http', status, url, apiReason } };
    }
    return { ok: true, data };
}

export const REDDIT_SECURITY_BLOCK_HINT = 'Reddit\'s network-security filter rejected this request. This is not an expired login: '
    + 'if `opencli reddit whoami` works, logging in again will not help. Reddit applies the block per endpoint and network; '
    + 'wait and retry later, or retry from a different network. The request was not retried.';

/** Throw the typed error for a `redditFetchJson` failure. `label` names the
 * request in the message (defaults to the failing URL). */
export function throwRedditFetchFailure(failure, label) {
    const where = label || failure?.url || 'Reddit request';
    const status = failure?.status;
    switch (failure?.reason) {
        case 'blocked':
            throw new CliError(
                'SECURITY_BLOCK',
                `Reddit blocked ${where} with its "blocked by network security" page (HTTP ${status}).`,
                REDDIT_SECURITY_BLOCK_HINT,
            );
        case 'rate-limited':
            throw new CliError(
                'RATE_LIMITED',
                `Reddit rate limited ${where} (HTTP 429).`,
                'Wait before making another request; the request was not retried.',
                EXIT_CODES.TEMPFAIL,
            );
        case 'html':
            throwIfLoginWall({
                __loginWall: true,
                status,
                url: failure.url || '',
                contentType: failure.contentType || '',
                bodyPreview: failure.bodyPreview || '',
            }, { url: where });
            break;
        case 'http': {
            const detail = `Reddit ${where} returned HTTP ${status}${failure.apiReason ? ` (${failure.apiReason})` : ''}`;
            if (status === 401 || status === 403) throw new AuthRequiredError('reddit.com', detail);
            if (status === 404) throw new EmptyResultError(where, `${detail}.`);
            throw new CommandExecutionError(`${detail}.`);
        }
        case 'malformed':
            throw new CommandExecutionError(`Reddit ${where} returned invalid JSON: ${failure.detail}`);
        case 'exception':
            throw new CommandExecutionError(`Reddit request ${where} failed: ${failure.detail}`);
    }
    throw new CommandExecutionError(`Unexpected Reddit fetch failure for ${where}: ${JSON.stringify(failure)}`);
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)
        && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

/** Fetch one Reddit JSON endpoint from the current page and return its body,
 * or throw the typed error for the failure. */
export async function fetchRedditJson(page, path, label = path) {
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const redditFetchJson = ${redditFetchJson.toString()};
      try {
        return await redditFetchJson(${JSON.stringify(path)});
      } catch (error) {
        return { ok: false, failure: { reason: 'exception', detail: String(error && error.message || error) } };
      }
    })()`));
    if (!result || result.ok !== true) throwRedditFetchFailure(result?.failure, label);
    return result.data;
}

/** Fetch a Reddit Listing endpoint and return `data.children`. */
export async function fetchRedditListing(page, path, label = path) {
    const payload = await fetchRedditJson(page, path, label);
    const children = payload?.data?.children;
    if (!Array.isArray(children)) {
        throw new CommandExecutionError(`Reddit ${label} returned a malformed listing (missing data.children).`);
    }
    return children;
}

// HTML fallback for listings. When Reddit answers a `.json` listing with its
// network-security page (#2720, #2771), the server-rendered feed partials on the
// same origin (`/svc/shreddit/community-more-posts/<sort>/`) are still served to
// the same session. Each organic post there is a `<shreddit-post>` element whose
// attributes carry the listing fields; promoted posts are `<shreddit-ad-post>`
// and are never read. Runs in the page (embed with `.toString()`); returns rows
// shaped like Listing children so the existing mappers stay unchanged.
export async function redditFetchShredditListing(firstPath, limit) {
    const origin = 'https://www.reddit.com';
    const hints = { text: 'self', image: 'image', link: 'link', video: 'hosted:video' };
    const rows = [];
    const seenIds = new Set();
    const seenPages = new Set();
    let next = firstPath;
    for (let pageNo = 0; next && rows.length < limit && pageNo < 10; pageNo++) {
        if (seenPages.has(next)) return { ok: false, failure: { reason: 'exception', detail: 'feed repeated its pagination cursor' } };
        seenPages.add(next);
        const response = await fetch(next, { credentials: 'include' });
        const text = await response.text();
        const status = response.status;
        const url = response.url || next;
        const contentType = (response.headers && response.headers.get('content-type')) || '';
        if (/blocked by network security/i.test(text) && !/<shreddit-post[\s>]/.test(text)) return { ok: false, failure: { reason: 'blocked', status, url } };
        if (status === 429) return { ok: false, failure: { reason: 'rate-limited', status, url } };
        if (!response.ok) return { ok: false, failure: { reason: 'http', status, url } };
        const landed = new URL(url, origin);
        if (landed.origin !== origin || /\/login\/?$|\/account\/login|\/challenge\/?$/.test(landed.pathname)) {
            return { ok: false, failure: { reason: 'html', status, url, contentType, bodyPreview: text.replace(/^\s+/, '').slice(0, 100) } };
        }
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const posts = Array.from(doc.querySelectorAll('shreddit-post'));
        if (!posts.length && pageNo === 0) {
            if (doc.querySelector('form[action*="/login"], #loginForm, #challenge-form, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')
                || /^(?:log in|login|access denied|blocked|security verification|just a moment)/i.test(doc.title || '')) {
                return { ok: false, failure: { reason: 'html', status, url, contentType, bodyPreview: text.replace(/^\s+/, '').slice(0, 100) } };
            }
        }
        for (const post of posts) {
            const name = post.getAttribute('id') || '';
            if (!/^t3_[a-z0-9]+$/.test(name)) return { ok: false, failure: { reason: 'exception', detail: 'feed post is missing its t3_ id' } };
            if (seenIds.has(name)) continue;
            seenIds.add(name);
            const type = post.getAttribute('post-type') || '';
            const created = Date.parse(post.getAttribute('created-timestamp') || '');
            const contentHref = post.getAttribute('content-href') || '';
            const body = post.querySelector('[slot="text-body"]');
            rows.push({ kind: 't3', data: {
                id: name.slice(3),
                name,
                title: post.getAttribute('post-title') || '',
                subreddit_name_prefixed: post.getAttribute('subreddit-prefixed-name') || '',
                author: post.getAttribute('author') || '',
                score: Number(post.getAttribute('score')) || 0,
                num_comments: Number(post.getAttribute('comment-count')) || 0,
                permalink: post.getAttribute('permalink') || '',
                created_utc: Number.isFinite(created) ? created / 1000 : 0,
                selftext: type === 'text' && body ? (body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '',
                post_hint: hints[type] || '',
                // content-href points back at the post itself for self/multi-media posts;
                // Reddit's JSON leaves url_overridden_by_dest empty for those.
                url_overridden_by_dest: type !== 'text' && contentHref && !contentHref.startsWith(origin + (post.getAttribute('permalink') || '\0')) ? contentHref : '',
            } });
            if (rows.length >= limit) break;
        }
        if (rows.length >= limit) break;
        const cursors = new Set();
        for (const partial of doc.querySelectorAll('faceplate-partial[src]')) {
            let partialUrl;
            try { partialUrl = new URL(partial.getAttribute('src'), origin); } catch { continue; }
            if (!/^\/svc\/shreddit\/community-more-posts\//.test(partialUrl.pathname) || !partialUrl.searchParams.get('after')) continue;
            if (partialUrl.origin !== origin || partialUrl.username || partialUrl.password) {
                return { ok: false, failure: { reason: 'exception', detail: 'feed returned an unsafe pagination URL' } };
            }
            cursors.add(partialUrl.pathname + partialUrl.search);
        }
        if (cursors.size > 1) return { ok: false, failure: { reason: 'exception', detail: 'feed has ambiguous pagination cursors' } };
        next = [...cursors][0] || '';
    }
    return { ok: true, data: { data: { children: rows } } };
}

/** Fetch a Reddit Listing endpoint; if Reddit's network-security filter blocks
 * the `.json` request, read the same listing from its server-rendered feed at
 * `htmlPath` instead. Every other failure is still reported as before. */
export async function fetchRedditListingWithHtmlFallback(page, path, htmlPath, limit, label = path) {
    try {
        return await fetchRedditListing(page, path, label);
    } catch (error) {
        if (error?.code !== 'SECURITY_BLOCK' || !htmlPath) throw error;
    }
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const redditFetchShredditListing = ${redditFetchShredditListing.toString()};
      try {
        return await redditFetchShredditListing(${JSON.stringify(htmlPath)}, ${Number(limit)});
      } catch (error) {
        return { ok: false, failure: { reason: 'exception', detail: String(error && error.message || error) } };
      }
    })()`));
    if (!result || result.ok !== true) throwRedditFetchFailure(result?.failure, `${label} (HTML feed fallback)`);
    return result.data.data.children;
}

export function decodeRedditHtml(value) {
    if (typeof value !== 'string' || !value) return '';
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/g, "'");
}

export function extractRedditMedia(d) {
    const galleryUrls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta && typeof meta === 'object') {
        for (const item of items) {
            const url = meta[item?.media_id]?.s?.u;
            if (typeof url === 'string' && url) galleryUrls.push(decodeRedditHtml(url));
        }
    }
    return {
        post_hint: typeof d?.post_hint === 'string' ? d.post_hint : '',
        url_overridden_by_dest: decodeRedditHtml(d?.url_overridden_by_dest || ''),
        preview_image_url: decodeRedditHtml(d?.preview?.images?.[0]?.source?.url || ''),
        gallery_urls: galleryUrls,
    };
}
