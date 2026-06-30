// Shared browser helpers for NodeSeek cookie-strategy commands.
//
// NodeSeek (www.nodeseek.com) is a Vue SSR app behind Cloudflare. Page content
// (posts, comments, search results, profiles) is server-rendered into the HTML,
// so we read it off the DOM rather than from XHR. The logged-in user is injected
// as `window.__config__.user`; `pjwt` is the session cookie. A handful of JSON
// endpoints (e.g. /api/account/getInfo/<id>, /api/notification/at-me/list) are
// fetched from within the authenticated page context.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const NS_HOME = 'https://www.nodeseek.com';

/** Validate a `--limit` argument (1..max), throwing ArgumentError otherwise. */
export function readLimit(value, { max = 100, def = 20, command = 'nodeseek' } = {}) {
    const n = value == null ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max)
        throw new ArgumentError(command, `limit must be an integer between 1 and ${max}`);
    return n;
}

/**
 * Scrape the rendered post list (`.post-list-item`) on the current page. Shared
 * by `latest` (home / category pages) and `search` — both render the same shape:
 * `.post-title a` (title + /post-<id>-1 href), category, author, <time>.
 */
export async function scrapePostList(page) {
    return page.evaluate(`(() => {
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
export async function ensureNsHome(page) {
    if (!page)
        throw new CommandExecutionError('Browser page required');
    await page.goto(NS_HOME + '/');
    await page.wait(2);
    for (let attempt = 0; attempt < 2; attempt++) {
        const rendered = await page.evaluate(`(() => { try { return !!window.__config__; } catch (e) { return false; } })()`);
        if (rendered)
            return;
        await page.wait(2);
    }
    throw new CommandExecutionError('NodeSeek did not render — Cloudflare challenge not passed or network issue');
}

/** True if the NodeSeek session cookie (pjwt) is present. */
export async function hasNsSessionCookie(page) {
    const cookies = await page.getCookies({ url: NS_HOME });
    return cookies.some((c) => c.name === 'pjwt' && c.value);
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
        throw new AuthRequiredError('nodeseek', `NodeSeek ${apiPath} HTTP ${res.status} — not logged in or session expired`);
    if (!res.ok)
        throw new CommandExecutionError(`NodeSeek ${apiPath} HTTP ${res.status}`);
    return res.data;
}
