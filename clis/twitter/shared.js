import { ArgumentError } from '@jackwener/opencli/errors';

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TWEET_PATH_PATTERN = /^\/(?:[^/]+|i)\/status\/(\d+)\/?$/;
const TWEET_HOSTS = new Set(['x.com', 'twitter.com']);

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
export async function resolveTwitterQueryId(page, operationName, fallbackId) {
    const resolved = await page.evaluate(`async () => {
    const operationName = ${JSON.stringify(operationName)};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json', { signal: controller.signal });
      clearTimeout(timeout);
      if (ghResp.ok) {
        const data = await ghResp.json();
        const entry = data?.[operationName];
        if (entry && entry.queryId) return entry.queryId;
      }
    } catch {
      clearTimeout(timeout);
    }
    try {
      const scripts = performance.getEntriesByType('resource')
        .filter(r => r.name.includes('client-web') && r.name.endsWith('.js'))
        .map(r => r.name);
      for (const scriptUrl of scripts.slice(0, 15)) {
        try {
          const text = await (await fetch(scriptUrl)).text();
          const re = new RegExp('queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"' + operationName + '"');
          const match = text.match(re);
          if (match) return match[1];
        } catch {}
      }
    } catch {}
    return null;
  }`);
    return sanitizeQueryId(resolved, fallbackId);
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

/**
 * Extract the link-preview card from a tweet's GraphQL response.
 *
 * Reads `tweet.card.legacy.{name, binding_values}` plus the expanded URL from
 * `tweet.legacy.entities.urls[0].expanded_url` (which is already t.co-resolved).
 * `binding_values` is an array of `{ key, value: { type, string_value, image_value: { url } } }`.
 *
 * Returns `null` when:
 *   - the tweet has no card, OR
 *   - the card is structurally empty (no landing URL AND no title/description),
 *     which would be useless to downstream renderers.
 *
 * Otherwise returns a partial card object — missing fields are simply omitted
 * (no `undefined` values in the output) so JSON consumers see a clean shape.
 */
export function extractCard(tweet) {
    const cardLegacy = tweet?.card?.legacy;
    if (!cardLegacy) return null;
    const bindings = Array.isArray(cardLegacy.binding_values) ? cardLegacy.binding_values : [];
    const byKey = new Map();
    for (const b of bindings) {
        if (b && typeof b.key === 'string') byKey.set(b.key, b.value);
    }
    const str = (key) => {
        const v = byKey.get(key);
        return typeof v?.string_value === 'string' && v.string_value.length > 0 ? v.string_value : undefined;
    };
    const img = (key) => {
        const v = byKey.get(key);
        const u = v?.image_value?.url;
        return typeof u === 'string' && u.length > 0 ? u : undefined;
    };
    const title = str('title');
    const description = str('description');
    const domainBinding = str('domain');
    const cardUrlBinding = str('card_url');
    const image_url = img('thumbnail_image_large') || img('photo_image_full_size_large') || img('summary_photo_image_large');
    const expandedUrl = tweet?.legacy?.entities?.urls?.[0]?.expanded_url;
    const url = (typeof expandedUrl === 'string' && expandedUrl.length > 0)
        ? expandedUrl
        : cardUrlBinding;
    let domain = domainBinding;
    if (!domain && url) {
        try { domain = new URL(url).hostname; }
        catch { /* malformed url — domain stays undefined */ }
    }
    if (!url && !title && !description) return null;
    const out = { name: cardLegacy.name };
    if (title) out.title = title;
    if (description) out.description = description;
    if (image_url) out.image_url = image_url;
    if (url) out.url = url;
    if (domain) out.domain = domain;
    return out;
}

export const __test__ = {
    sanitizeQueryId,
    extractMedia,
    extractCard,
    parseTweetUrl,
    buildTwitterArticleScopeSource,
};
