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

export function normalizeTwitterOperationFlags(value) {
    if (Array.isArray(value)) return keysToFlags(value);
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key, flag]) => typeof key === 'string' && key && typeof flag === 'boolean'),
    );
}

function normalizeOperationFallback(fallback) {
    if (typeof fallback === 'string') return { queryId: fallback, features: {}, fieldToggles: {} };
    return {
        queryId: fallback?.queryId || null,
        features: normalizeTwitterOperationFlags(fallback?.features),
        fieldToggles: normalizeTwitterOperationFlags(fallback?.fieldToggles),
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

function isEmptyObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

export function looksLikePrivateTwitterTimeline(data) {
    const result = data?.data?.user?.result;
    if (!result || typeof result !== 'object') return false;
    return Boolean(isEmptyObject(result.timeline) || isEmptyObject(result.timeline_v2?.timeline));
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
        features: Object.keys(normalizeTwitterOperationFlags(value?.features)).length > 0
            ? normalizeTwitterOperationFlags(value.features)
            : normalizedFallback.features,
        fieldToggles: Object.keys(normalizeTwitterOperationFlags(value?.fieldToggles)).length > 0
            ? normalizeTwitterOperationFlags(value.fieldToggles)
            : normalizedFallback.fieldToggles,
    };
}

// Pure helper extracted for unit testing. Used both directly in tests and
// serialized into page.evaluate() below so the same logic runs in-browser.
//
// Why two regexes with [^}] separator instead of cutting a snippet around
// the operationName marker:
//   The old approach (lastIndexOf 'e.exports=' / indexOf '}}}') was prone to
//   cross-module pollution. In a minified bundle 'e.exports=' is dense, and
//   the snippet often spanned multiple operation modules. snippet.match(/queryId/)
//   would then return the FIRST queryId in the snippet — frequently belonging
//   to a different operation — and Twitter would reject it as expired.
//   Anchoring queryId immediately adjacent to operationName (≤400 chars,
//   non-} characters only) guarantees the queryId belongs to this operation.
export function parseOperationFromBundleText(text, operationName) {
    if (!text || !operationName) return null;
    const esc = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reA = new RegExp(`queryId:"([A-Za-z0-9_-]+)"[^}]{0,400}operationName:"${esc}"`);
    const reB = new RegExp(`operationName:"${esc}"[^}]{0,400}queryId:"([A-Za-z0-9_-]+)"`);
    let queryId = null;
    let matchIndex = -1;
    const mA = text.match(reA);
    if (mA && typeof mA.index === 'number') {
        queryId = mA[1];
        matchIndex = mA.index;
    } else {
        const mB = text.match(reB);
        if (mB && typeof mB.index === 'number') {
            queryId = mB[1];
            matchIndex = mB.index;
        }
    }
    if (!queryId) return null;
    const winStart = Math.max(0, matchIndex - 500);
    const winEnd = Math.min(text.length, matchIndex + 1500);
    const win = text.slice(winStart, winEnd);
    const quotedKeys = (source) => source
        ? Array.from(source.matchAll(/"([^"]+)"/g)).map((m) => m[1])
        : [];
    const flags = (keys) => Object.fromEntries(
        (keys || []).filter((k) => typeof k === 'string' && k).map((k) => [k, true]),
    );
    return {
        queryId,
        features: flags(quotedKeys(win.match(/featureSwitches:\[([^\]]*)\]/)?.[1])),
        fieldToggles: flags(quotedKeys(win.match(/fieldToggles:\[([^\]]*)\]/)?.[1])),
    };
}

export async function resolveTwitterOperationMetadata(page, operationName, fallback) {
    const parserSource = parseOperationFromBundleText.toString();
    // Order: GitHub placeholder.json FIRST (more reliable — fa0311/twitter-openapi
    // tracks Twitter's queryId rotation), bundle scan SECOND as offline fallback.
    // The previous order (bundle-first) silently returned wrong queryIds from
    // cross-module snippet pollution and never reached the GitHub path.
    const resolved = await page.evaluate(`async () => {
    const operationName = ${JSON.stringify(operationName)};
    const keysToFlags = (keys) => Object.fromEntries((keys || []).filter((k) => typeof k === 'string' && k).map((key) => [key, true]));
    const normalizeFlags = (value) => {
      if (Array.isArray(value)) return keysToFlags(value);
      if (!value || typeof value !== 'object') return {};
      return Object.fromEntries(Object.entries(value).filter(([key, flag]) => typeof key === 'string' && key && typeof flag === 'boolean'));
    };
    const parseOperationFromBundleText = ${parserSource};

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json', { signal: controller.signal });
        clearTimeout(timeout);
        if (ghResp.ok) {
          const data = await ghResp.json();
          const entry = data && data[operationName];
          if (entry && entry.queryId) {
            return {
              queryId: entry.queryId,
              features: normalizeFlags(entry.features ?? entry.featureSwitches),
              fieldToggles: normalizeFlags(entry.fieldToggles),
            };
          }
        }
      } catch {
        clearTimeout(timeout);
      }
    } catch {}

    try {
      const scripts = Array.from(document.scripts)
        .map(s => s.src)
        .filter(Boolean)
        .concat(performance.getEntriesByType('resource')
          .map(r => r.name)
          .filter(r => r.includes('client-web') && r.endsWith('.js')));
      const uniqueScripts = Array.from(new Set(scripts));
      const head = uniqueScripts.slice(0, 15);
      const tail = uniqueScripts.slice(-15);
      const candidates = Array.from(new Set([...head, ...tail]));
      for (const scriptUrl of candidates) {
        try {
          const text = await (await fetch(scriptUrl)).text();
          const operation = parseOperationFromBundleText(text, operationName);
          if (operation) return operation;
        } catch {}
      }
    } catch {}

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

/**
 * Extract the link-preview card from a tweet's GraphQL response.
 *
 * Reads `tweet.card.legacy.{name, binding_values}` plus the expanded URL from
 * the `tweet.legacy.entities.urls` entry matching the card's t.co URL.
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
    const urlEntities = Array.isArray(tweet?.legacy?.entities?.urls)
        ? tweet.legacy.entities.urls
        : [];
    const matchingEntity = cardUrlBinding
        ? urlEntities.find((entity) => entity?.url === cardUrlBinding || entity?.expanded_url === cardUrlBinding)
        : undefined;
    const matchedExpandedUrl = matchingEntity?.expanded_url;
    const url = (typeof matchedExpandedUrl === 'string' && matchedExpandedUrl.length > 0)
        ? matchedExpandedUrl
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

/**
 * Extract the quoted tweet from a tweet's GraphQL response.
 *
 * A quote tweet is a tweet that embeds and comments on another tweet (distinct
 * from a reply or retweet). The author writes new commentary and the embedded
 * tweet renders as a card-like preview under the new tweet.
 *
 * GraphQL surfaces this as `tweet.quoted_status_result.result`, which contains
 * the same `legacy / core / card / note_tweet` shape as the outer tweet — so
 * we reuse `extractMedia` / `extractCard` on the nested object. Detection is
 * gated by `legacy.is_quote_status === true` (plus the presence of the nested
 * result) so we don't return junk on plain replies that share field shapes.
 *
 * Returns `null` when:
 *   - the tweet is not a quote, OR
 *   - the nested `quoted_status_result.result` is missing/empty/tombstoned.
 *
 * Only goes ONE level deep — a quote-of-a-quote returns its level-1 quoted
 * tweet without further nesting. Recursing would explode payload size on
 * threads where every reply re-quotes the original.
 *
 * The output shape is a deliberately small subset of the main tweet shape
 * (id/author/name/text/created_at/url + media + card). Consumers that need
 * counts or full author bio of the quoted tweet can re-fetch the quoted id
 * via `twitter thread <id>` — keeping this slim avoids ballooning every
 * timeline/list/search response by 2-3x.
 */
export function extractQuotedTweet(tweet) {
    const legacy = tweet?.legacy;
    if (!legacy?.is_quote_status) return null;
    const q = tweet?.quoted_status_result?.result
        ?? tweet?.legacy?.quoted_status_result?.result;
    // `result` can be a tombstone (`__typename: 'TweetTombstone'`) or
    // `'TweetUnavailable'` when the quoted tweet was deleted / privacy-restricted —
    // it has no `legacy`, so the downstream null-check covers both cases.
    if (!q) return null;
    // Nested `tweet` wrapper appears on TweetWithVisibilityResults — same
    // shim that callers already do at the top level (`tw.tweet || tw`).
    const qTw = q.tweet || q;
    if (!qTw || typeof qTw !== 'object') return null;
    const qLegacy = qTw.legacy && typeof qTw.legacy === 'object' ? qTw.legacy : {};
    // `rest_id` is required — tombstoned / unavailable wrappers have neither
    // rest_id nor legacy. Don't fall back to outer `legacy.quoted_status_id_str`:
    // the id alone can't substitute for missing content (author/text/media all
    // empty), so emitting a stub object would mislead downstream renderers into
    // drawing an empty "quoted tweet" preview.
    if (typeof qTw.rest_id !== 'string' || !qTw.rest_id.trim()) return null;
    const qUser = qTw.core?.user_results?.result;
    const qLegacyScreenName = qUser?.legacy?.screen_name;
    const qCoreScreenName = qUser?.core?.screen_name;
    const qScreenName = typeof qLegacyScreenName === 'string' && qLegacyScreenName.trim()
        ? qLegacyScreenName.trim()
        : (typeof qCoreScreenName === 'string' && qCoreScreenName.trim() ? qCoreScreenName.trim() : '');
    if (!SCREEN_NAME_PATTERN.test(qScreenName)) return null;
    const qLegacyDisplayName = qUser?.legacy?.name;
    const qCoreDisplayName = qUser?.core?.name;
    const qDisplayName = typeof qLegacyDisplayName === 'string'
        ? qLegacyDisplayName
        : (typeof qCoreDisplayName === 'string' ? qCoreDisplayName : '');
    const qNoteText = qTw.note_tweet?.note_tweet_results?.result?.text;
    const qText = (typeof qNoteText === 'string' && qNoteText.length > 0)
        ? qNoteText
        : (typeof qLegacy.full_text === 'string' ? qLegacy.full_text : '');
    const qMedia = extractMedia(qLegacy);
    const qCard = extractCard(qTw);
    if (!qText && !qMedia.has_media && !qCard) return null;
    const out = {
        id: qTw.rest_id,
        author: qScreenName,
        name: qDisplayName,
        text: qText,
        created_at: typeof qLegacy.created_at === 'string' ? qLegacy.created_at : '',
        url: `https://x.com/${qScreenName}/status/${qTw.rest_id}`,
        has_media: qMedia.has_media,
        media_urls: qMedia.media_urls,
    };
    if (qCard) out.card = qCard;
    return out;
}

/**
 * Translate a non-200 Twitter API response into a message that distinguishes
 * the actual HTTP failure mode, so callers (scripts / scrapers / pipelines)
 * can choose retry / cooldown / re-auth / drop without misreading "queryId
 * expired" as the universal cause.
 *
 * @param {string} operation - GraphQL operationName or REST endpoint label
 *                             (e.g. 'SearchTimeline', 'TweetDetail',
 *                             'device_follow'); used in the error prefix.
 * @param {number|string} status - HTTP status code from page.evaluate fetch
 *                                 (e.g. r.status); coerced to Number.
 * @param {string} [extraHint] - Optional adapter-specific hint appended after
 *                               the generic explanation (e.g. "list may be
 *                               private", "folder may not exist").
 * @returns {string} Message intended for `new CommandExecutionError(...)`.
 */
export function describeTwitterApiError(operation, status, extraHint) {
    const code = Number(status);
    const prefix = `HTTP ${status}: ${operation} fetch failed`;
    let suffix;
    if (code === 429) {
        suffix = 'rate-limited by Twitter (session quota); retry after cooldown (typically 15-30 min)';
    } else if (code === 401) {
        suffix = 'auth failed (cookie expired or invalidated); re-login required';
    } else if (code === 403) {
        suffix = 'forbidden (cookie lacks scope, or resource is private)';
    } else if (code === 404) {
        suffix = 'resource not found (deleted, suspended, or private)';
    } else if (code >= 500 && code < 600) {
        suffix = 'Twitter server error; retry later';
    } else {
        suffix = 'possibly queryId expired, schema change, or transient';
    }
    if (extraHint) suffix = `${suffix} (${extraHint})`;
    return `${prefix} — ${suffix}`;
}

export const __test__ = {
    sanitizeQueryId,
    normalizeTwitterOperationFlags,
    sanitizeTwitterOperationMetadata,
    unwrapBrowserResult,
    normalizeTwitterGraphqlPayload,
    normalizeTwitterScreenName,
    extractMedia,
    extractCard,
    extractQuotedTweet,
    parseTweetUrl,
    buildTwitterArticleScopeSource,
    looksLikePrivateTwitterTimeline,
    parseOperationFromBundleText,
    describeTwitterApiError,
};
