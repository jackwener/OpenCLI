import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const INSTAGRAM_APP_ID = '936619743392459';
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 1000;
const BATCH_LIMIT = 50;
const USER_HOME = 'https://www.instagram.com';
const DEFAULT_CAPTION_FILTER_MODE = 'contains';
const CAPTION_FILTER_MODES = ['contains', 'regex'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNIX_SECONDS_RE = /^\d{10}$/;
const UNIX_MILLISECONDS_RE = /^\d{13}$/;
function requirePositiveBoundedInt(value, options) {
    const { defaultValue, max, label } = options;
    const normalized = value === undefined ? defaultValue : Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (normalized > max) {
        throw new ArgumentError(`${label} must be <= ${max}`);
    }
    return normalized;
}
function normalizeShortcode(item) {
    return String(item?.code || '').trim();
}
function normalizeCaptionText(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
}
function normalizeCaptionFilterMode(value) {
    const mode = String(value || DEFAULT_CAPTION_FILTER_MODE).trim().toLowerCase();
    if (!CAPTION_FILTER_MODES.includes(mode)) {
        throw new ArgumentError(`Invalid caption-filter-mode: ${value}. Supported values: contains, regex`);
    }
    return mode;
}
function compileCaptionMatcher(pattern, options) {
    const { mode, caseSensitive, label } = options;
    const normalized = normalizeCaptionText(pattern);
    if (!normalized) {
        return null;
    }
    if (mode === 'regex') {
        const flags = caseSensitive ? '' : 'i';
        try {
            const re = new RegExp(normalized, flags);
            return (caption) => re.test(normalizeCaptionText(caption));
        }
        catch (error) {
            throw new ArgumentError(`Invalid ${label} regular expression: ${error?.message || error}`);
        }
    }
    const needle = caseSensitive ? normalized : normalized.toLowerCase();
    return (caption) => {
        const text = normalizeCaptionText(caption);
        return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle);
    };
}
function makeCaptionFilter(kwargs) {
    const filterMode = normalizeCaptionFilterMode(kwargs['caption-filter-mode']);
    const includePattern = normalizeCaptionText(kwargs['caption-filter'] || kwargs.captionFilter);
    const rejectPattern = normalizeCaptionText(kwargs['caption-reject'] || kwargs.captionReject);
    const caseSensitive = kwargs['caption-case-sensitive'] === true || kwargs.captionCaseSensitive === true;
    if (filterMode === 'regex' && !includePattern && !rejectPattern) {
        return null;
    }
    if (!includePattern && !rejectPattern) {
        return null;
    }
    const includeMatcher = includePattern
        ? compileCaptionMatcher(includePattern, { mode: filterMode, caseSensitive, label: 'caption-filter' })
        : null;
    const rejectMatcher = rejectPattern
        ? compileCaptionMatcher(rejectPattern, { mode: filterMode, caseSensitive, label: 'caption-reject' })
        : null;
    return {
        test(raw) {
            const caption = normalizeCaptionText(raw);
            if (rejectMatcher && rejectMatcher(caption)) {
                return false;
            }
            if (!includeMatcher) {
                return true;
            }
            return includeMatcher(caption);
        },
    };
}
function normalizeMediaType(item) {
    if (item?.media_type === 1) {
        return 'photo';
    }
    if (item?.media_type === 2) {
        return 'video';
    }
    return 'carousel';
}
function resolvePostKind(item) {
    const kind = String(item?.product_type || '').toLowerCase();
    if (kind === 'clips' || kind === 'reel') {
        return 'reel';
    }
    if (item?.is_reel_media) {
        return 'reel';
    }
    return 'p';
}
function formatInstagramDate(timestamp) {
    const seconds = Number(timestamp || 0);
    return Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000).toLocaleDateString()
        : '';
}
function formatInstagramPostedAt(timestamp) {
    const seconds = Number(timestamp || 0);
    return Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000).toISOString()
        : '';
}
function buildInstagramPostUrl(shortcode, kind = 'p') {
    return shortcode ? `${USER_HOME}/${kind}/${shortcode}/` : '';
}
function parseDayBounds(value, options = {}) {
    const label = options.label || 'date';
    const normalized = String(value || '').trim();
    if (!DAY_RE.test(normalized)) {
        throw new ArgumentError(`Invalid --${label}: ${JSON.stringify(value)}. Use YYYY-MM-DD.`);
    }
    const startMs = new Date(`${normalized}T00:00:00`).getTime();
    const endMs = new Date(`${normalized}T23:59:59.999`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new ArgumentError(`Invalid --${label}: ${JSON.stringify(value)}. Use YYYY-MM-DD.`);
    }
    return {
        startSec: Math.floor(startMs / 1000),
        endSec: Math.floor(endMs / 1000),
    };
}
function parseTimestampArg(value, options = {}) {
    const label = options.label || 'from';
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new ArgumentError(`Missing --${label} timestamp`);
    }
    if (UNIX_SECONDS_RE.test(normalized)) {
        return Number(normalized);
    }
    if (UNIX_MILLISECONDS_RE.test(normalized)) {
        return Math.floor(Number(normalized) / 1000);
    }
    const ms = new Date(normalized).getTime();
    if (!Number.isFinite(ms)) {
        throw new ArgumentError(`Invalid --${label}: ${JSON.stringify(value)}. Use ISO 8601 like 2026-07-11T18:30:00+05:30 or Unix seconds.`);
    }
    return Math.floor(ms / 1000);
}
function resolveTimeWindow(kwargs) {
    const dateArg = String(kwargs.date || '').trim();
    const fromArg = String(kwargs.from || '').trim();
    const toArg = String(kwargs.to || '').trim();
    if (dateArg && (fromArg || toArg)) {
        throw new ArgumentError('Cannot combine --date with --from/--to. Use --date YYYY-MM-DD for a whole day, or --from/--to for an exact time range.');
    }
    if (toArg && !fromArg) {
        throw new ArgumentError('Using --to requires --from.');
    }
    if (dateArg) {
        return parseDayBounds(dateArg, { label: 'date' });
    }
    if (!fromArg && !toArg) {
        return null;
    }
    const startSec = parseTimestampArg(fromArg, { label: 'from' });
    const endSec = toArg ? parseTimestampArg(toArg, { label: 'to' }) : Number.POSITIVE_INFINITY;
    if (endSec < startSec) {
        throw new ArgumentError('--from must be earlier than or equal to --to.');
    }
    return { startSec, endSec };
}
async function fetchInstagramJson(page, url) {
    try {
        const response = await page.evaluate(async (requestUrl, appId) => {
            const headers = { 'X-IG-App-ID': appId };
            const request = await fetch(requestUrl, {
                credentials: 'include',
                headers,
            });
            const text = await request.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            }
            catch {
                data = null;
            }
            return {
                ok: request.ok,
                status: request.status,
                text,
                data,
            };
        }, url, INSTAGRAM_APP_ID);
        if (!response || typeof response !== 'object') {
            throw new Error('Instagram API returned no payload');
        }
        return response;
    }
    catch (error) {
        throw new CommandExecutionError(`Instagram API request failed for ${url}: ${error?.message || error}`);
    }
}
function isRateLimited(result) {
    const message = String(result?.text || '').toLowerCase();
    const status = Number(result?.status || 0);
    return status === 429 || message.includes('rate limit') || message.includes('wait a few minutes');
}
function isAuthRequired(result) {
    const status = Number(result?.status || 0);
    if (status === 401 || status === 403)
        return true;
    const message = String(result?.text || '').toLowerCase();
    return message.includes('login') || message.includes('require_login');
}
function normalizeFeedItem(item, rank) {
    const shortcode = normalizeShortcode(item);
    const kind = resolvePostKind(item);
    const captionSource = item?.caption?.text || item?.caption || '';
    return {
        index: rank,
        caption: normalizeCaptionText(captionSource),
        likes: item?.like_count ?? 0,
        comments: item?.comment_count ?? 0,
        type: normalizeMediaType(item),
        date: formatInstagramDate(item?.taken_at),
        posted_at: formatInstagramPostedAt(item?.taken_at),
        kind,
        shortcode,
        media_id: String(item?.id || ''),
        url: buildInstagramPostUrl(shortcode, kind),
    };
}
function parseFeedItems(data) {
    return Array.isArray(data) ? data : [];
}
function isWithinTimeWindow(timestamp, timeWindow) {
    if (!timeWindow) {
        return true;
    }
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return false;
    }
    return seconds >= timeWindow.startSec && seconds <= timeWindow.endSec;
}
async function collectUserPosts(page, userId, limit, captionFilter) {
    const rows = [];
    const dedup = new Set();
    let maxId = '';
    let keepPaging = true;

    while (rows.length < limit && keepPaging) {
        const remaining = limit - rows.length;
        const pageCount = remaining > BATCH_LIMIT ? BATCH_LIMIT : remaining;
        const base = `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${pageCount}`;
        const url = maxId ? `${base}&max_id=${encodeURIComponent(maxId)}` : base;
        const result = await fetchInstagramJson(page, url);
        if (!result.ok) {
            if (isAuthRequired(result)) {
                throw new AuthRequiredError('www.instagram.com', result.text || `HTTP ${result.status}`);
            }
            if (isRateLimited(result)) {
                throw new CommandExecutionError('Instagram feed request is rate limited', 'Wait a few minutes and retry.');
            }
            throw new CommandExecutionError('Failed to fetch user posts', `Instagram returned HTTP ${result.status} for ${url}`);
        }
        const data = result.data || {};
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('Instagram returned an unexpected response for user feed');
        }
        const items = parseFeedItems(data.items);
        if (items.length === 0) {
            break;
        }
        for (const item of items) {
            const shortcode = normalizeShortcode(item);
            if (!shortcode || dedup.has(shortcode))
                continue;
            const captionText = item?.caption?.text || item?.caption || '';
            if (captionFilter && !captionFilter.test(captionText)) {
                continue;
            }
            dedup.add(shortcode);
            rows.push(normalizeFeedItem(item, rows.length + 1));
            if (rows.length >= limit) {
                return rows;
            }
        }
        if (!data.more_available) {
            keepPaging = false;
            break;
        }
        const nextMaxId = String(data.next_max_id || '').trim();
        if (!nextMaxId || nextMaxId === maxId) {
            break;
        }
        maxId = nextMaxId;
        if (rows.length < limit) {
            await page.wait({ time: 0.5 });
        }
    }
    return rows;
}
async function collectUserPostsByTimeWindow(page, userId, limit, captionFilter, timeWindow) {
    const rows = [];
    const dedup = new Set();
    let maxId = '';
    let keepPaging = true;
    while (rows.length < limit && keepPaging) {
        const remaining = limit - rows.length;
        const pageCount = remaining > BATCH_LIMIT ? BATCH_LIMIT : remaining;
        const base = `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${pageCount}`;
        const url = maxId ? `${base}&max_id=${encodeURIComponent(maxId)}` : base;
        const result = await fetchInstagramJson(page, url);
        if (!result.ok) {
            if (isAuthRequired(result)) {
                throw new AuthRequiredError('www.instagram.com', result.text || `HTTP ${result.status}`);
            }
            if (isRateLimited(result)) {
                throw new CommandExecutionError('Instagram feed request is rate limited', 'Wait a few minutes and retry.');
            }
            throw new CommandExecutionError('Failed to fetch user posts', `Instagram returned HTTP ${result.status} for ${url}`);
        }
        const data = result.data || {};
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('Instagram returned an unexpected response for user feed');
        }
        const items = parseFeedItems(data.items);
        if (items.length === 0) {
            break;
        }
        let hitOlderThanRange = false;
        for (const item of items) {
            const takenAt = Number(item?.taken_at || 0);
            if (Number.isFinite(takenAt) && takenAt > 0 && takenAt < timeWindow.startSec) {
                hitOlderThanRange = true;
                break;
            }
            const shortcode = normalizeShortcode(item);
            if (!shortcode || dedup.has(shortcode))
                continue;
            if (!isWithinTimeWindow(takenAt, timeWindow)) {
                continue;
            }
            const captionText = item?.caption?.text || item?.caption || '';
            if (captionFilter && !captionFilter.test(captionText)) {
                continue;
            }
            dedup.add(shortcode);
            rows.push(normalizeFeedItem(item, rows.length + 1));
            if (rows.length >= limit) {
                return rows;
            }
        }
        if (hitOlderThanRange || !data.more_available) {
            keepPaging = false;
            break;
        }
        const nextMaxId = String(data.next_max_id || '').trim();
        if (!nextMaxId || nextMaxId === maxId) {
            break;
        }
        maxId = nextMaxId;
        if (rows.length < limit) {
            await page.wait({ time: 0.5 });
        }
    }
    return rows;
}
cli({
    site: 'instagram',
    name: 'user',
    access: 'read',
    description: 'Get recent posts from an Instagram user',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: 'https://www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of posts (1-${MAX_LIMIT})` },
        {
            name: 'date',
            default: '',
            help: 'Fetch posts from one full local day. Format: YYYY-MM-DD. Cannot be combined with --from/--to.',
        },
        {
            name: 'from',
            default: '',
            help: 'Fetch posts from this timestamp onward. Use ISO 8601 like 2026-07-11T18:30:00+05:30 or Unix seconds.',
        },
        {
            name: 'to',
            default: '',
            help: 'Fetch posts up to this timestamp. Requires --from. Use ISO 8601 like 2026-07-12T18:30:00+05:30 or Unix seconds.',
        },
        {
            name: 'caption-filter-mode',
            default: DEFAULT_CAPTION_FILTER_MODE,
            choices: CAPTION_FILTER_MODES,
            help: 'Caption matching mode: contains or regex',
        },
        { name: 'caption-filter', default: '', help: 'Keep only posts whose caption matches this pattern' },
        { name: 'caption-reject', default: '', help: 'Drop posts whose caption matches this pattern (same mode as caption-filter-mode)' },
        { name: 'caption-case-sensitive', type: 'bool', default: false, help: 'Match captions case-sensitively' },
    ],
    columns: ['index', 'caption', 'likes', 'comments', 'type', 'date', 'posted_at', 'kind', 'shortcode', 'media_id', 'url'],
    func: async (page, kwargs) => {
        const username = String(kwargs.username || '').trim().replace(/^@+/, '');
        if (!username) {
            throw new ArgumentError('Instagram username is required');
        }
        const limit = requirePositiveBoundedInt(kwargs.limit, {
            defaultValue: DEFAULT_LIMIT,
            max: MAX_LIMIT,
            label: 'Instagram user limit',
        });
        const captionFilter = makeCaptionFilter(kwargs);
        const timeWindow = resolveTimeWindow(kwargs);

        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
        const profileResult = await fetchInstagramJson(page, profileUrl);
        if (!profileResult.ok) {
            if (isAuthRequired(profileResult)) {
                throw new AuthRequiredError('www.instagram.com', 'Instagram login required to read user profile');
            }
            if (isRateLimited(profileResult)) {
                throw new CommandExecutionError('Instagram profile request is rate limited', 'Wait a few minutes and retry.');
            }
            throw new CommandExecutionError('Failed to resolve Instagram user', `Instagram returned HTTP ${profileResult.status} for profile lookup`);
        }
        const userId = String(profileResult.data?.data?.user?.id || '').trim();
        if (!userId) {
            throw new CommandExecutionError(`Instagram user not found: ${username}`);
        }
        const rows = timeWindow
            ? await collectUserPostsByTimeWindow(page, userId, limit, captionFilter, timeWindow)
            : await collectUserPosts(page, userId, limit, captionFilter);
        if (rows.length === 0) {
            throw new EmptyResultError('instagram user', `No posts found for ${username}`);
        }
        return rows;
    },
    __test__: {
        DEFAULT_LIMIT,
        MAX_LIMIT,
        DEFAULT_CAPTION_FILTER_MODE,
        BATCH_LIMIT,
        parseFeedItems,
        normalizeCaptionFilterMode,
        compileCaptionMatcher,
        makeCaptionFilter,
        resolvePostKind,
        normalizeFeedItem,
        normalizeMediaType,
        requirePositiveBoundedInt,
        buildInstagramPostUrl,
        parseDayBounds,
        parseTimestampArg,
        resolveTimeWindow,
        isWithinTimeWindow,
        isAuthRequired,
        isRateLimited,
        formatInstagramDate,
        formatInstagramPostedAt,
    },
});
