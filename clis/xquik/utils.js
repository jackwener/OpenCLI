import {
    ArgumentError,
    CommandExecutionError,
    ConfigError,
    TimeoutError,
} from '@jackwener/opencli/errors';

export const XQUIK_API_BASE = 'https://xquik.com/api/v1';
export const XQUIK_API_CONTRACT = '2026-04-29';

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new ArgumentError(`xquik ${label} cannot be empty`);
    }
    return text;
}

export function requireBoundedInt(value, defaultValue, maxValue, label) {
    const raw = value ?? defaultValue;
    const number = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(number) || number <= 0) {
        throw new ArgumentError(`xquik ${label} must be a positive integer`);
    }
    if (number > maxValue) {
        throw new ArgumentError(`xquik ${label} must be <= ${maxValue}`);
    }
    return number;
}

export function requireApiKey() {
    const apiKey = process.env.XQUIK_API_KEY?.trim();
    if (!apiKey) {
        throw new ConfigError(
            'xquik commands require XQUIK_API_KEY',
            'Create an API key at https://dashboard.xquik.com and export XQUIK_API_KEY.',
        );
    }
    return apiKey;
}

function errorMessage(body) {
    if (typeof body?.error?.message === 'string') return body.error.message;
    if (typeof body?.message === 'string') return body.message;
    if (typeof body?.error === 'string') return body.error;
    return '';
}

function retryHint(response, body) {
    const header = response.headers.get('retry-after');
    const bodySeconds = body?.error?.retry_after ?? body?.retry_after ?? body?.retryAfter;
    const seconds = header || (Number.isFinite(Number(bodySeconds)) ? String(bodySeconds) : '');
    return seconds
        ? `Retry after ${seconds} seconds.`
        : 'Wait before retrying.';
}

export async function xquikFetch(url, label, timeoutSeconds) {
    const apiKey = requireApiKey();
    let response;
    try {
        response = await fetch(url, {
            headers: {
                accept: 'application/json',
                'user-agent': 'OpenCLI Xquik adapter (+https://github.com/jackwener/OpenCLI)',
                'x-api-key': apiKey,
                'xquik-api-contract': XQUIK_API_CONTRACT,
            },
            signal: AbortSignal.timeout(timeoutSeconds * 1000),
        });
    } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
            throw new TimeoutError(label, timeoutSeconds, 'Retry, or increase --timeout.');
        }
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that https://xquik.com is reachable from this network.',
        );
    }

    let body = null;
    try {
        body = await response.json();
    } catch (error) {
        if (response.ok) {
            throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
        }
    }

    const detail = errorMessage(body);
    if (response.status === 401 || response.status === 403) {
        throw new ConfigError(
            `${label} authentication failed${detail ? `: ${detail}` : ''}`,
            'Set XQUIK_API_KEY to a valid Xquik API key.',
        );
    }
    if (response.status === 402) {
        throw new CommandExecutionError(
            `${label} requires available Xquik credits${detail ? `: ${detail}` : ''}`,
            'Add credits in the Xquik dashboard, then retry.',
        );
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} was rate limited${detail ? `: ${detail}` : ''}`,
            retryHint(response, body),
        );
    }
    if (!response.ok) {
        throw new CommandExecutionError(
            `${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
            response.status === 424 || response.status >= 500 ? 'The upstream X read failed. Retry later.' : undefined,
        );
    }
    if (body?.error) {
        throw new CommandExecutionError(`${label} returned an error${detail ? `: ${detail}` : ''}`);
    }
    return body;
}

function metric(tweet, normalizedName, legacyName) {
    const raw = tweet[normalizedName] ?? tweet[legacyName];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        throw new CommandExecutionError(`xquik search row has invalid ${normalizedName}`);
    }
    return raw;
}

function createdAt(tweet) {
    const raw = tweet.created ?? tweet.created_at ?? tweet.createdAt;
    if (raw == null || raw === '') return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const date = new Date(raw * 1000);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof raw === 'string') return raw;
    throw new CommandExecutionError('xquik search row has invalid created timestamp');
}

function mediaUrls(tweet) {
    if (tweet.media == null) return [];
    if (!Array.isArray(tweet.media)) {
        throw new CommandExecutionError('xquik search row has malformed media');
    }
    return [...new Set(tweet.media.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const url = item.url ?? item.media_url_https ?? item.preview_url ?? item.previewUrl;
        return typeof url === 'string' && url ? [url] : [];
    }))];
}

export function normalizeSearchRow(tweet, rank) {
    if (!tweet || typeof tweet !== 'object' || Array.isArray(tweet)) {
        throw new CommandExecutionError('xquik search row is not an object');
    }
    const id = typeof tweet.id === 'string' ? tweet.id.trim() : '';
    if (!id || typeof tweet.text !== 'string') {
        throw new CommandExecutionError('xquik search row is missing id or text');
    }
    const author = tweet.author && typeof tweet.author === 'object' && !Array.isArray(tweet.author)
        ? tweet.author
        : {};
    const username = typeof author.username === 'string' ? author.username : '';
    return {
        rank,
        id,
        author: username,
        name: typeof author.name === 'string' ? author.name : '',
        bio: typeof author.description === 'string' ? author.description : '',
        text: tweet.text,
        created_at: createdAt(tweet),
        likes: metric(tweet, 'like_count', 'likeCount'),
        retweets: metric(tweet, 'retweet_count', 'retweetCount'),
        replies: metric(tweet, 'reply_count', 'replyCount'),
        quotes: metric(tweet, 'quote_count', 'quoteCount'),
        bookmarks: metric(tweet, 'bookmark_count', 'bookmarkCount'),
        views: metric(tweet, 'view_count', 'viewCount'),
        url: typeof tweet.url === 'string' && tweet.url
            ? tweet.url
            : `https://x.com/${username || 'i'}/status/${id}`,
        media_urls: mediaUrls(tweet),
    };
}
