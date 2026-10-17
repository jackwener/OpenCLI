/**
 * Shared helpers for Xiaohongshu commands that drive the page's own Pinia
 * stores instead of replaying signed HTTP requests.
 *
 * Why: xhs web APIs (edith.xiaohongshu.com/api/sns/web/...) require `X-s`,
 * `X-t` and `X-S-Common` headers. `window._webmsxyw` produces the first two
 * but `X-S-Common` is bound to them and to the browser fingerprint, so a
 * hand-built fetch() from page.evaluate is rejected with 461 / code 300015
 * ("浏览器运行环境异常"). The Vue app's Pinia store actions go through the
 * app's own axios instance, which attaches every header correctly, so we
 * call those actions and read the reactive state back.
 *
 * The store registry is reachable at
 *   document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
 * (a Map keyed by store id: 'user', 'search', 'feed', ...).
 */
import { ArgumentError } from '@jackwener/opencli/errors';

/** Accept raw ids like `5d8f88dc0000000001005d3a` as well as `/user/profile/<id>` URLs. */
const USER_ID_RE = /^[a-zA-Z0-9]{8,32}$/;

export function isXiaohongshuHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com');
}

/**
 * Normalise a user id or profile URL into a bare user id, throwing
 * ArgumentError for anything that is not a plausible xhs user id.
 */
export function requireXhsUserId(raw, commandLabel = 'xiaohongshu') {
    const input = String(raw ?? '').trim();
    if (/^https?:\/\//i.test(input)) {
        let parsed;
        try {
            parsed = new URL(input);
        }
        catch {
            throw new ArgumentError(`${commandLabel}: invalid profile URL`);
        }
        if (parsed.protocol !== 'https:' || !isXiaohongshuHost(parsed.hostname)) {
            throw new ArgumentError(`${commandLabel}: profile URL must be an https://*.xiaohongshu.com URL`);
        }
        const match = parsed.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
        if (!match) {
            throw new ArgumentError(`${commandLabel}: profile URL must be /user/profile/<userId>`);
        }
        return match[1];
    }
    const userId = input.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
    if (!userId || !USER_ID_RE.test(userId)) {
        throw new ArgumentError(`${commandLabel}: user-id must be a Xiaohongshu user ID (e.g. 5d8f88dc0000000001005d3a) or full profile URL`);
    }
    return userId;
}

export function xhsProfileUrl(userId, webHost = 'www.xiaohongshu.com') {
    return `https://${webHost}/user/profile/${userId}`;
}

/**
 * Parse xhs display counts into plain numbers. Handles `"9776"`, `"1.2万"`,
 * `"3亿"`, `"9.8K"`, `"1.5M"` and numeric input. Returns null when the value
 * cannot be interpreted, so callers can emit `null` rather than a fake 0.
 */
export function parseXhsCount(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.round(value) : null;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const text = value.replace(/[\s,，+]/g, '').trim();
    if (!text) {
        return null;
    }
    const match = text.match(/^(\d+(?:\.\d+)?)(万|亿|[kKwW]|[mM])?$/);
    if (!match) {
        return null;
    }
    const base = Number(match[1]);
    if (!Number.isFinite(base)) {
        return null;
    }
    const unit = match[2] || '';
    const multiplier = unit === '万' || unit === 'w' || unit === 'W' ? 10_000
        : unit === '亿' ? 100_000_000
            : unit === 'k' || unit === 'K' ? 1_000
                : unit === 'm' || unit === 'M' ? 1_000_000
                    : 1;
    return Math.round(base * multiplier);
}

/** Normalise avatar URLs to https and drop the empty string. */
export function normalizeXhsAvatar(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        return null;
    }
    return text.replace(/^http:\/\//i, 'https://');
}

/**
 * Browser-side prelude: defines `__xhsStore(id)` and `__xhsClone(value)`.
 * Embed at the top of any page.evaluate IIFE that needs Pinia access.
 */
export const PINIA_ACCESS_JS = `
  const __xhsStore = (id) => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
    const pinia = app && app.config && app.config.globalProperties && app.config.globalProperties.$pinia;
    const stores = pinia && pinia._s;
    return stores && typeof stores.get === 'function' ? (stores.get(id) || null) : null;
  };
  const __xhsClone = (value) => {
    try { return JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch { return null; }
  };
  const __xhsLoggedOut = () => {
    const user = __xhsStore('user');
    const loggedIn = user ? __xhsClone(user.loggedIn) : null;
    const onLoginPage = typeof location !== 'undefined' && location.pathname.indexOf('/login') === 0;
    return onLoginPage || loggedIn === false;
  };
`;

/**
 * JS that resolves once the Pinia registry (and optionally a named store) is
 * reachable, or times out. Returns 'ready' | 'timeout'.
 */
export function buildWaitForStoreJs(storeId, timeoutMs = 8000) {
    return `
    new Promise((resolve) => {
      ${PINIA_ACCESS_JS}
      const deadline = Date.now() + ${Number(timeoutMs)};
      const check = () => {
        if (__xhsStore(${JSON.stringify(storeId)})) return resolve('ready');
        if (Date.now() > deadline) return resolve('timeout');
        setTimeout(check, 200);
      };
      check();
    })
  `;
}

export const __test__ = { USER_ID_RE };
