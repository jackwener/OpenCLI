import { ArgumentError } from '@jackwener/opencli/errors';

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_PATH_PATTERN = /^\/(?:[^/]+|i)\/status\/(\d+)\/?$/;
const TWEET_HOSTS = new Set(['x.com', 'twitter.com']);
const SCREEN_NAME_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com']);
const RESERVED_SCREEN_NAME_PATHS = new Set([
    'compose',
    'explore',
    'help',
    'home',
    'i',
    'intent',
    'jobs',
    'login',
    'logout',
    'messages',
    'notifications',
    'privacy',
    'search',
    'settings',
    'signup',
    'tos',
]);

function isTwitterHost(hostname) {
    return TWEET_HOSTS.has(hostname)
        || hostname.endsWith('.x.com')
        || hostname.endsWith('.twitter.com');
}

export function parseTweetUrl(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) {
        throw new ArgumentError('twitter tweet URL cannot be empty', 'Example: opencli twitter retweet https://x.com/jack/status/20');
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new ArgumentError(`Invalid tweet URL: ${value}`, 'Use a full https://x.com/<user>/status/<id> URL');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !isTwitterHost(hostname)) {
        throw new ArgumentError(`Invalid tweet URL host: ${value}`, 'Use a full https://x.com/<user>/status/<id> URL');
    }
    const match = parsed.pathname.match(TWEET_PATH_PATTERN);
    if (!match?.[1]) {
        throw new ArgumentError(`Could not extract tweet ID from URL: ${value}`, 'Use a full https://x.com/<user>/status/<id> URL');
    }
    return {
        id: match[1],
        url: parsed.toString(),
    };
}

/**
 * Build a JS source fragment that, when embedded inside a `page.evaluate(...)`
 * IIFE, declares browser-side helpers for scoping operations to a specific
 * tweet by status id. Sibling adapters historically inlined ad-hoc article
 * lookups that either (a) skipped scoping entirely (silent: act on first
 * matching button on a conversation page) or (b) used substring matches like
 * `pathname.includes('/status/' + tweetId)` (silent: `/status/123` matches
 * `/status/1234567`). This helper centralises the canonical pattern so all
 * write-actions reuse the same exact-match guard.
 *
 * Declared bindings (available to the embedding IIFE):
 *   - `tweetId`                       : the requested status id (string)
 *   - `__twGetStatusIdFromHref(href)` : extract status id from a link href, or null
 *   - `__twHasLinkToTarget(root)`     : true iff `root` contains any link to tweetId
 *   - `findTargetArticle()`           : the <article> matching tweetId, or undefined
 */
export function buildTwitterArticleScopeSource(tweetId) {
    return `
        const tweetId = ${JSON.stringify(tweetId)};
        const __twTweetPathRe = /^\\/(?:[^/]+|i)\\/status\\/(\\d+)\\/?$/;
        const __twIsTwitterHost = (hostname) => hostname === 'x.com'
            || hostname === 'twitter.com'
            || hostname.endsWith('.x.com')
            || hostname.endsWith('.twitter.com');
        const __twGetStatusIdFromHref = (href) => {
            try {
                const parsed = new URL(href, window.location.origin);
                if (parsed.protocol !== 'https:' || !__twIsTwitterHost(parsed.hostname.toLowerCase())) {
                    return null;
                }
                return parsed.pathname.match(__twTweetPathRe)?.[1] || null;
            } catch {
                return null;
            }
        };
        const __twHasLinkToTarget = (root) => Array.from(root.querySelectorAll('a[href*="/status/"]'))
            .some((link) => __twGetStatusIdFromHref(link.href) === tweetId);
        const findTargetArticle = () => Array.from(document.querySelectorAll('article'))
            .find(__twHasLinkToTarget);
    `;
}

export function sanitizeQueryId(resolved, fallbackId) {
    return typeof resolved === 'string' && QUERY_ID_PATTERN.test(resolved) ? resolved : fallbackId;
}

export function normalizeTwitterScreenName(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    let candidate = '';
    try {
        const url = raw.startsWith('/') ? new URL(raw, 'https://x.com') : new URL(raw);
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            !SCREEN_NAME_HOSTS.has(url.hostname)
        ) {
            return '';
        }
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 1) return '';
        candidate = segments[0];
    } catch {
        if (raw.includes('/') || raw.includes('?') || raw.includes('#')) return '';
        candidate = raw.replace(/^@+/, '');
    }
    if (!SCREEN_NAME_PATTERN.test(candidate)) return '';
    if (RESERVED_SCREEN_NAME_PATHS.has(candidate.toLowerCase())) return '';
    return candidate;
}

function keysToFlags(keys) {
    if (!Array.isArray(keys)) return {};
    return Object.fromEntries(keys.filter((key) => typeof key === 'string' && key).map((key) => [key, true]));
}

function normalizeOperationFallback(fallback) {
    if (typeof fallback === 'string') return { queryId: fallback, features: {}, fieldToggles: {} };
    return {
        queryId: fallback?.queryId || null,
        features: fallback?.features || {},
        fieldToggles: fallback?.fieldToggles || {},
    };
}

export function unwrapBrowserResult(value) {
    if (
        value
        && typeof value === 'object'
        && typeof value.session === 'string'
        && Object.prototype.hasOwnProperty.call(value, 'data')
    ) {
        return value.data;
    }
    return value;
}

export function normalizeTwitterGraphqlPayload(value) {
    const unwrapped = unwrapBrowserResult(value);
    if (unwrapped?.data && typeof unwrapped.data === 'object') return unwrapped;
    if (
        unwrapped
        && typeof unwrapped === 'object'
        && (
            Object.prototype.hasOwnProperty.call(unwrapped, 'user')
            || Object.prototype.hasOwnProperty.call(unwrapped, 'search_by_raw_query')
        )
    ) {
        return { data: unwrapped };
    }
    return unwrapped;
}

export function sanitizeTwitterOperationMetadata(resolved, fallback) {
    const value = unwrapBrowserResult(resolved);
    const normalizedFallback = normalizeOperationFallback(fallback);
    // Empty resolved features / fieldToggles must defer to the baked fallback.
    // The bundle parser can find a queryId but miss `featureSwitches:[...]` (e.g.
    // a minification change, or the 2500-char snippet window truncating before
    // the array). When that happens, keysToFlags(undefined) returns {}; if we
    // kept it, Twitter would receive an empty `features` map and respond 400,
    // surfacing a misleading "queryId expired" error.
    return {
        queryId: sanitizeQueryId(value?.queryId, normalizedFallback.queryId),
        features: value?.features
            && typeof value.features === 'object'
            && Object.keys(value.features).length > 0
            ? value.features
            : normalizedFallback.features,
        fieldToggles: value?.fieldToggles
            && typeof value.fieldToggles === 'object'
            && Object.keys(value.fieldToggles).length > 0
            ? value.fieldToggles
            : normalizedFallback.fieldToggles,
    };
}

export async function resolveTwitterOperationMetadata(page, operationName, fallback) {
    const resolved = await page.evaluate(`async () => {
    const operationName = ${JSON.stringify(operationName)};
    const keysToFlags = (keys) => Object.fromEntries((keys || []).map((key) => [key, true]));
    const quotedKeys = (source) => source
      ? Array.from(source.matchAll(/"([^"]+)"/g)).map((match) => match[1])
      : [];
    const parseOperation = (text) => {
      const marker = 'operationName:"' + operationName + '"';
      const index = text.indexOf(marker);
      if (index < 0) return null;
      const start = Math.max(0, text.lastIndexOf('e.exports=', index));
      const endMarker = text.indexOf('}}}', index);
      const snippet = text.slice(start, endMarker > index ? endMarker + 3 : index + 2500);
      const queryId = snippet.match(/queryId:"([A-Za-z0-9_-]+)"/)?.[1] || null;
      if (!queryId) return null;
      return {
        queryId,
        features: keysToFlags(quotedKeys(snippet.match(/featureSwitches:\\[([^\\]]*)\\]/)?.[1])),
        fieldToggles: keysToFlags(quotedKeys(snippet.match(/fieldToggles:\\[([^\\]]*)\\]/)?.[1])),
      };
    };
    try {
      const scripts = Array.from(document.scripts)
        .map(s => s.src)
        .filter(Boolean)
        .concat(performance.getEntriesByType('resource')
          .map(r => r.name)
          .filter(r => r.includes('client-web') && r.endsWith('.js')));
      const uniqueScripts = Array.from(new Set(scripts));
      for (const scriptUrl of uniqueScripts.slice(-30)) {
        try {
          const text = await (await fetch(scriptUrl)).text();
          const operation = parseOperation(text);
          if (operation) return operation;
        } catch {}
      }
    } catch {}
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json', { signal: controller.signal });
      clearTimeout(timeout);
      if (ghResp.ok) {
        const data = await ghResp.json();
        const entry = data?.[operationName];
        if (entry && entry.queryId) {
          return {
            queryId: entry.queryId,
            features: keysToFlags(entry.featureSwitches),
            fieldToggles: keysToFlags(entry.fieldToggles),
          };
        }
      }
    } catch {
      clearTimeout(timeout);
    }
    return null;
  }`);
    return sanitizeTwitterOperationMetadata(resolved, fallback);
}

export async function resolveTwitterQueryId(page, operationName, fallbackId) {
    const operation = await resolveTwitterOperationMetadata(page, operationName, fallbackId);
    return operation.queryId;
}
/**
 * Extract media flags and URLs from a tweet's `legacy` object.
 *
 * Prefers `extended_entities.media` (superset with full video_info) and falls
 * back to `entities.media` when the extended form is missing. For videos and
 * animated GIFs, returns the mp4 variant URL; for photos, returns
 * `media_url_https`.
 */
export function extractMedia(legacy) {
    const media = legacy?.extended_entities?.media || legacy?.entities?.media;
    if (!Array.isArray(media) || media.length === 0) {
        return { has_media: false, media_urls: [] };
    }
    const urls = [];
    for (const m of media) {
        if (!m) continue;
        if (m.type === 'video' || m.type === 'animated_gif') {
            const variants = m.video_info?.variants || [];
            const mp4 = variants.find((v) => v?.content_type === 'video/mp4');
            const url = mp4?.url || m.media_url_https;
            if (url) urls.push(url);
        } else {
            if (m.media_url_https) urls.push(m.media_url_https);
        }
    }
    return { has_media: urls.length > 0, media_urls: urls };
}
export const __test__ = {
    sanitizeQueryId,
    sanitizeTwitterOperationMetadata,
    unwrapBrowserResult,
    normalizeTwitterGraphqlPayload,
    normalizeTwitterScreenName,
    extractMedia,
    parseTweetUrl,
    buildTwitterArticleScopeSource,
};
