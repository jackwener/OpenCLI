// Shared browser helpers for NodeSeek cookie-strategy commands.
//
// NodeSeek (www.nodeseek.com) is a Vue SSR app behind Cloudflare. Page content
// (posts, comments, search results, profiles) is server-rendered into the HTML,
// so we read it off the DOM rather than from XHR. The logged-in user is injected
// as `window.__config__.user`; `pjwt` is the session cookie. A handful of JSON
// endpoints (e.g. /api/account/getInfo/<id>, /api/notification/at-me/list) are
// fetched from within the authenticated page context.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

export const NS_HOME = 'https://www.nodeseek.com';

/** Validate a `--limit` argument (1..max), throwing ArgumentError otherwise. */
export function readLimit(value, { max = 100, def = 20 } = {}) {
    const n = value == null ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max)
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    return n;
}

/**
 * Scrape the rendered post list (`.post-list-item`) on the current page. Shared
 * by `latest` (home / category pages) and `search` — both render the same shape:
 * `.post-title a` (title + /post-<id>-1 href), category, author, <time>.
 */
export async function scrapePostList(page) {
    const rows = await page.evaluate(`(() => {
        return [...document.querySelectorAll('.post-list-item')].map((it) => {
            const a = it.querySelector('.post-title a');
            const t = it.querySelector('time');
            const cat = it.querySelector('[class*="categor"]');
            const author = it.querySelector('.author-name, [class*="author"]');
            const href = a ? (a.getAttribute('href') || '') : '';
            const m = href.match(/post-(\\d+)/);
            return {
                post_id: m ? m[1] : '',
                title: (a?.textContent || '').trim(),
                category: (cat?.textContent || '').trim(),
                author: (author?.textContent || '').trim(),
                time: t ? (t.getAttribute('datetime') || t.textContent.trim()) : '',
                link: href ? 'https://www.nodeseek.com' + href : '',
            };
        });
    })()`);
    return Array.isArray(rows) ? rows : [];
}

/** Drop incomplete/duplicate rows (by post_id) and cap at `limit`. */
export function finalizeListRows(rows, limit) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        if (!r.title || !r.post_id || seen.has(r.post_id))
            continue;
        seen.add(r.post_id);
        out.push(r);
    }
    return out.slice(0, Math.max(1, limit || 20));
}

/**
 * Navigate to NodeSeek home (passes Cloudflare + establishes same-origin), then
 * confirm the Vue app actually rendered. NodeSeek injects `window.__config__` on
 * every real page; if it's absent after the wait we're looking at a Cloudflare
 * interstitial or a failed load — surface that instead of letting downstream
 * scrapers return an empty DOM that reads as "no results".
 */
const RENDER_CHECK = `(() => { try { return !!window.__config__; } catch (e) { return false; } })()`;

export async function ensureNsHome(page) {
    if (!page)
        throw new CommandExecutionError('Browser page required');
    // The runtime pre-navigates cookie commands to the site (navigateBefore), so
    // skip the second full page load when we're already on a rendered NodeSeek page.
    if (page.getCurrentUrl) {
        const url = await page.getCurrentUrl();
        if (typeof url === 'string' && /^https?:\/\/([^/]+\.)?nodeseek\.com\//.test(url)
            && await page.evaluate(RENDER_CHECK))
            return;
    }
    await page.goto(NS_HOME + '/');
    await page.wait(2);
    if (await page.evaluate(RENDER_CHECK))
        return;
    await page.wait(2);
    if (await page.evaluate(RENDER_CHECK))
        return;
    throw new CommandExecutionError('NodeSeek did not render — Cloudflare challenge not passed or network issue');
}

/** The NodeSeek session cookie (pjwt) value, or null when anonymous. */
export async function getNsSessionCookie(page) {
    const cookies = await page.getCookies({ url: NS_HOME });
    return cookies.find((c) => c.name === 'pjwt' && c.value)?.value ?? null;
}

/** True if the NodeSeek session cookie (pjwt) is present. */
export async function hasNsSessionCookie(page) {
    return (await getNsSessionCookie(page)) !== null;
}

/**
 * Walk numbered pages, scraping each and deduping by `keyOf`, until `limit`
 * rows are collected, a page yields nothing new, or `pageCap` is hit. Shared
 * by `latest`, `search`, and `post` — NodeSeek renders all three as paged
 * lists. `skipFirstNav` reuses the page the caller already navigated to
 * (e.g. ensureNsHome landing on home) instead of reloading it.
 */
export async function collectPaged(page, { urlFor, scrape, keyOf, limit, pageCap, label, skipFirstNav = false }) {
    const collected = [];
    const seen = new Set();
    let reachedEnd = false;
    for (let pageNo = 1; pageNo <= pageCap && collected.length < limit; pageNo++) {
        if (!(skipFirstNav && pageNo === 1)) {
            await page.goto(urlFor(pageNo));
            await page.wait(2);
        }
        const rows = await scrape(page);
        let fresh = 0;
        for (const r of Array.isArray(rows) ? rows : []) {
            const key = keyOf(r);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            collected.push(r);
            fresh++;
        }
        if (fresh === 0) { reachedEnd = true; break; } // empty page or all duplicates
        if (collected.length < limit)
            log.status(`${label}: fetched page ${pageNo} (${collected.length} rows)`);
    }
    // Hit the page cap before satisfying `limit`: tell the user results are truncated.
    if (!reachedEnd && collected.length < limit)
        log.warn(`${label}: stopped at the ${pageCap}-page cap with ${collected.length} rows; more may exist`);
    return collected;
}

/** Read the SSR-injected current user object, or null if anonymous. */
export async function readCurrentUser(page, { skipNavigate = false } = {}) {
    if (!skipNavigate)
        await ensureNsHome(page);
    return page.evaluate(`(() => {
        try { return (window.__config__ && window.__config__.user) || null; }
        catch (e) { return null; }
    })()`);
}

/** Fetch a NodeSeek JSON API path from within the authenticated page context. */
export async function fetchNsJson(page, apiPath, { skipNavigate = false } = {}) {
    if (!skipNavigate)
        await ensureNsHome(page);
    const escaped = JSON.stringify(apiPath);
    const res = await page.evaluate(`(async () => {
        try {
            const r = await fetch(${escaped}, { credentials: 'include', headers: { Accept: 'application/json' } });
            let data = null;
            try { data = await r.json(); } catch {}
            return { ok: r.ok, status: r.status, data };
        } catch (e) { return { ok: false, status: 0, data: null, error: String(e && e.message || e) }; }
    })()`);
    if (!res || res.status === 0)
        throw new CommandExecutionError(`NodeSeek ${apiPath} request failed: ${res?.error || 'unknown'}`);
    if (res.status === 401 || res.status === 403)
        throw new AuthRequiredError('nodeseek.com', `NodeSeek ${apiPath} HTTP ${res.status} — not logged in or session expired`);
    if (!res.ok)
        throw new CommandExecutionError(`NodeSeek ${apiPath} HTTP ${res.status}`);
    return res.data;
}
