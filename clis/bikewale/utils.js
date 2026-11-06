/**
 * Shared helpers for BikeWale adapters.
 *
 * BikeWale is a NodeJS SSR app (shared codebase with CarWale) that embeds its
 * hydration state inline as `window.__INITIAL_STATE__ = {...};`. A plain Node
 * `fetch()` (no auth, no browser, no anti-bot) returns it. All commands here are
 * PUBLIC `fetch()` + `extractInitialState()`.
 */

import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const BASE = 'https://www.bikewale.com';
export const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Pull `window.__INITIAL_STATE__` out of an SSR HTML page via balanced-brace
 * scanning (string/escape aware). Pure (string in, object|null out) so it runs
 * identically over live fetch bodies and frozen fixtures.
 */
export function extractInitialState(html) {
    const text = String(html || '');
    const marker = text.indexOf('window.__INITIAL_STATE__');
    if (marker < 0) return null;
    const start = text.indexOf('{', marker);
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"') {
            inStr = true;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * Fetch a BikeWale page and return its parsed `__INITIAL_STATE__`.
 *
 * @param {string} url           Absolute BikeWale URL.
 * @param {object} opts
 * @param {string} opts.context  Human label for error messages, e.g. `brand "honda"`.
 * @param {string} [opts.notFound]  When set, a 404 throws ArgumentError with this
 *                                  message (use for user-supplied slugs).
 * @param {boolean} [opts.soft404]  When true, a 404 returns null instead of
 *                                  throwing (lets callers try a fallback slug).
 */
export async function fetchInitialState(url, { context, notFound, soft404 } = {}) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: { 'User-Agent': UA, Referer: `${BASE}/`, 'Accept-Language': 'en-IN,en;q=0.9' },
        });
    } catch (err) {
        throw new CommandExecutionError(`bikewale ${context} network error: ${err?.message || err}`);
    }
    if (resp.status === 404 && soft404) {
        return null;
    }
    if (resp.status === 404 && notFound) {
        throw new ArgumentError(notFound, 'Check the slug — try the name with no spaces, e.g. "royalenfield".');
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`bikewale ${context} HTTP ${resp.status}`);
    }
    const state = extractInitialState(await resp.text());
    if (!state) {
        throw new CommandExecutionError(
            `bikewale ${context} returned no __INITIAL_STATE__.`,
            'BikeWale may have changed its page structure, or served an anti-bot page.',
        );
    }
    return state;
}

/** Collapse a name/slug to its comparable core: lowercase alphanumerics only. */
export function slugCore(input) {
    return String(input ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve user input to a brand's authoritative masking slug and brand-page state.
 *
 * Most slugs are a bare run of letters ("royalenfield", "honda") so the stripped
 * form is tried directly. But some are hyphenated ("brixton-motorcycles",
 * "hop-electric"), which the stripped form can't reproduce — so on a 404 we look
 * the brand up in the homepage `makeList` by its comparable core and use the real
 * slug. Returns the verified brand-page state + slug.
 */
export async function resolveBrand(input) {
    const core = slugCore(input);
    if (!core) {
        throw new ArgumentError('brand is required, e.g. "royalenfield", "honda", "bajaj".');
    }

    const direct = await fetchInitialState(`${BASE}/${core}-bikes/`, {
        context: `brand "${core}"`,
        soft404: true,
    });
    if (direct) return { state: direct, mask: core };

    // Hyphenated or otherwise non-obvious slug: look it up in the brand list.
    const home = await fetchInitialState(`${BASE}/`, { context: 'brand lookup' });
    const makes = Array.isArray(home?.homePage?.makeList) ? home.homePage.makeList : [];
    const hit = makes.find((m) => slugCore(m?.maskingName) === core || slugCore(m?.makeName) === core);
    if (!hit?.maskingName) {
        throw new ArgumentError(
            `bikewale brand "${input}" not found.`,
            'Run `opencli bikewale brands` to see the valid brand slugs.',
        );
    }
    const mask = hit.maskingName;
    const state = await fetchInitialState(`${BASE}/${mask}-bikes/`, { context: `brand "${mask}"` });
    return { state, mask };
}
