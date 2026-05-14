import { ArgumentError, CommandExecutionError, ConfigError, EmptyResultError } from '@jackwener/opencli/errors';

export const XQUIK_BASE = 'https://xquik.com/api/v1';
const USER_AGENT = 'opencli-xquik/1.0 (+https://github.com/jackwener/OpenCLI)';

export function requireString(value, name) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new ArgumentError(`xquik --${name} is required`);
    }
    return text;
}

export function requireBoundedInt(value, defaultValue, maxValue, name = 'limit') {
    const raw = value == null || value === '' ? defaultValue : value;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
        throw new ArgumentError(`xquik --${name} must be an integer between 1 and ${maxValue}`);
    }
    return parsed;
}

function requireApiKey() {
    const apiKey = String(process.env.XQUIK_API_KEY ?? '').trim();
    if (!apiKey) {
        throw new ConfigError(
            'xquik requires XQUIK_API_KEY',
            'Set XQUIK_API_KEY in the environment before running xquik commands.',
        );
    }
    return apiKey;
}

export function addParam(url, name, value) {
    if (value == null || value === '') return;
    url.searchParams.set(name, String(value));
}

function errorCode(body) {
    if (!body || typeof body !== 'object') return '';
    const error = body.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof error.code === 'string') return error.code;
    return '';
}

export async function xquikFetch(path, label) {
    const url = path instanceof URL ? path : new URL(String(path).replace(/^\/+/, ''), `${XQUIK_BASE}/`);
    const apiKey = requireApiKey();
    let response;
    try {
        response = await fetch(url, {
            headers: {
                accept: 'application/json',
                'user-agent': USER_AGENT,
                'x-api-key': apiKey,
            },
        });
    } catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that xquik.com is reachable from this network.',
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

    if (response.status === 401) {
        throw new ConfigError('xquik rejected XQUIK_API_KEY', 'Check that XQUIK_API_KEY is valid.');
    }
    if (response.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404.`);
    }
    if (response.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429`, 'Wait briefly and retry.');
    }
    if (!response.ok) {
        const code = errorCode(body);
        const suffix = code ? ` (${code})` : '';
        throw new CommandExecutionError(`${label} returned HTTP ${response.status}${suffix}`);
    }
    return body;
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function authorName(tweet, fallbackAuthor) {
    return tweet?.author?.username ?? fallbackAuthor?.username ?? '';
}

function tweetUrl(id) {
    return id ? `https://x.com/i/web/status/${id}` : '';
}

export function normalizeTweet(tweet, index, options = {}) {
    const id = String(tweet?.id ?? '');
    return {
        rank: index + 1,
        id,
        author: authorName(tweet, options.author),
        text: String(tweet?.text ?? ''),
        createdAt: String(tweet?.createdAt ?? ''),
        likes: numberOrNull(tweet?.likeCount),
        replies: numberOrNull(tweet?.replyCount),
        retweets: numberOrNull(tweet?.retweetCount),
        quotes: numberOrNull(tweet?.quoteCount),
        views: numberOrNull(tweet?.viewCount),
        url: tweet?.url || tweetUrl(id),
        nextCursor: options.nextCursor ?? '',
    };
}

export function normalizeUser(user, index) {
    const username = String(user?.username ?? '').replace(/^@+/, '');
    return {
        rank: index + 1,
        id: String(user?.id ?? ''),
        username,
        name: String(user?.name ?? ''),
        followers: numberOrNull(user?.followers),
        following: numberOrNull(user?.following),
        verified: Boolean(user?.verified),
        description: String(user?.description ?? ''),
        location: String(user?.location ?? ''),
        createdAt: String(user?.createdAt ?? ''),
        profileUrl: username ? `https://x.com/${username}` : '',
    };
}

export function paginatedRows(body, field, label, normalizer) {
    const list = Array.isArray(body?.[field]) ? body[field] : [];
    if (!list.length) {
        throw new EmptyResultError(label, `Xquik returned no ${field}.`);
    }
    const nextCursor = body?.next_cursor || body?.nextCursor || '';
    return list.map((item, index) => normalizer(item, index, { nextCursor }));
}
