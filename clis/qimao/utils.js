import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const QIMAO_ORIGIN = 'https://www.qimao.com';
export const QIMAO_DOMAIN = 'www.qimao.com';
const QIMAO_UA = 'opencli-qimao-adapter (+https://github.com/jackwener/opencli)';

const HTML_ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    hellip: '...',
    ldquo: '“',
    rdquo: '”',
    lsquo: '‘',
    rsquo: '’',
    mdash: '—',
    ndash: '–',
};

export function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
        .replace(/&#(\d+);/g, (_, dec) => {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
        .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITY_MAP[name] ?? match);
}

export function stripHtml(value) {
    if (value == null) {
        return '';
    }
    const withLineBreaks = String(value)
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*\/p\s*>/gi, '\n')
        .replace(/<\s*p[^>]*>/gi, '');
    return decodeHtmlEntities(withLineBreaks)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => cleanText(line))
        .filter(Boolean)
        .join('\n');
}

export function requireString(value, label) {
    const text = cleanText(value);
    if (!text) {
        throw new ArgumentError(`qimao ${label} cannot be empty`);
    }
    return text;
}

export function requirePositiveInt(value, defaultValue, label) {
    const raw = value ?? defaultValue;
    const num = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(num) || num <= 0) {
        throw new ArgumentError(`qimao ${label} must be a positive integer`);
    }
    return num;
}

export function requireNonNegativeInt(value, defaultValue, label) {
    const raw = value ?? defaultValue;
    const num = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(num) || num < 0) {
        throw new ArgumentError(`qimao ${label} must be a non-negative integer`);
    }
    return num;
}

export function requireLimit(value, defaultValue = 20, maxValue = 50) {
    const limit = requirePositiveInt(value, defaultValue, 'limit');
    if (limit > maxValue) {
        throw new ArgumentError(`qimao limit must be <= ${maxValue}`);
    }
    return limit;
}

export function normalizeStatus(value) {
    if (value === '完结' || value === 1 || value === '1' || value === true) {
        return '完结';
    }
    if (value === '连载' || value === 0 || value === '0' || value === false) {
        return '连载';
    }
    return cleanText(value);
}

export function buildBookUrl(bookId) {
    return `${QIMAO_ORIGIN}/shuku/${bookId}/`;
}

export function buildReaderUrl(bookId) {
    return `${QIMAO_ORIGIN}/reader/index/${bookId}/`;
}

export function buildChapterUrl(bookId, chapterId) {
    return `${QIMAO_ORIGIN}/shuku/${bookId}-${chapterId}/`;
}

export function buildSearchApiUrl(query, page = 1, pageSize = 15) {
    const url = new URL('/qimaoapi/api/search/result', QIMAO_ORIGIN);
    url.searchParams.set('keyword', query);
    url.searchParams.set('count', '0');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    return url.toString();
}

export function buildChapterListApiUrl(bookId) {
    const url = new URL('/qimaoapi/api/book/chapter-list', QIMAO_ORIGIN);
    url.searchParams.set('book_id', String(bookId));
    return url.toString();
}

export function buildClassifySelectOptionApiUrl() {
    return new URL('/qimaoapi/api/classify/select-option', QIMAO_ORIGIN).toString();
}

export function buildClassifyBookListApiUrl(filters = {}) {
    const url = new URL('/qimaoapi/api/classify/book-list', QIMAO_ORIGIN);
    url.searchParams.set('channel', String(filters.channel ?? 'a'));
    url.searchParams.set('category1', String(filters.category1 ?? 'a'));
    url.searchParams.set('category2', String(filters.category2 ?? 'a'));
    url.searchParams.set('words', String(filters.words ?? 'a'));
    url.searchParams.set('update_time', String(filters.updateTime ?? 'a'));
    url.searchParams.set('is_vip', String(filters.isVip ?? 'a'));
    url.searchParams.set('is_over', String(filters.isOver ?? 'a'));
    url.searchParams.set('order', String(filters.order ?? 'click'));
    url.searchParams.set('page', String(filters.page ?? 1));
    return url.toString();
}

export function buildRankUrl(channelType = 'boy', rankType = 'hot', dateType = 'date') {
    return `${QIMAO_ORIGIN}/paihang/${channelType}/${rankType}/${dateType}/`;
}

export function parseBookId(value) {
    const raw = requireString(value, 'book');
    if (/^\d+$/.test(raw)) {
        return raw;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new ArgumentError(
            `Unrecognized qimao book reference: ${raw}`,
            'Use a numeric book id like 1784909 or a Qimao book/chapter URL.',
        );
    }
    const matched = parsed.pathname.match(/^\/(?:shuku|reader\/index)\/(\d+)(?:-(\d+))?\/?$/);
    if (!matched?.[1]) {
        throw new ArgumentError(
            `Unrecognized qimao book URL: ${raw}`,
            'Supported URLs look like /shuku/<bookId>/, /shuku/<bookId>-<chapterId>/, or /reader/index/<bookId>/.',
        );
    }
    return matched[1];
}

export function parseChapterId(value) {
    const raw = requireString(value, 'chapter-id');
    if (/^\d+$/.test(raw)) {
        return raw;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new ArgumentError(
            `Unrecognized qimao chapter reference: ${raw}`,
            'Use a numeric chapter id or a Qimao chapter URL.',
        );
    }
    const matched = parsed.pathname.match(/^\/shuku\/\d+-(\d+)\/?$/);
    if (!matched?.[1]) {
        throw new ArgumentError(
            `Unrecognized qimao chapter URL: ${raw}`,
            'Supported chapter URLs look like /shuku/<bookId>-<chapterId>/.',
        );
    }
    return matched[1];
}

export function formatTimestamp(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return '';
    }
    const millis = num < 1e12 ? num * 1000 : num;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeJsonBody(body, label) {
    if (!body || typeof body !== 'object' || typeof body.data !== 'object') {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape`);
    }
    return body.data;
}

async function qimaoBrowserFetchJson(page, url, label, referer) {
    if (!page?.evaluate) {
        throw new CommandExecutionError(
            `${label} request failed: browser fallback is unavailable`,
            'Run this command with browser support enabled.',
        );
    }

    const response = await page.evaluate(`(async () => {
        const response = await fetch(${JSON.stringify(url)}, {
            headers: {
                accept: 'application/json',
                referer: ${JSON.stringify(referer)},
            },
            credentials: 'omit',
        });
        return {
            ok: response.ok,
            status: response.status,
            text: await response.text(),
        };
    })()`);

    if (response.status === 404) {
        throw new EmptyResultError(label, `Qimao returned 404 for ${url}.`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    }

    try {
        return normalizeJsonBody(JSON.parse(response.text), label);
    }
    catch (error) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
    }
}

export async function qimaoFetchJson(url, label, referer = `${QIMAO_ORIGIN}/`, page) {
    try {
        const response = await fetch(url, {
            headers: {
                accept: 'application/json',
                referer,
                'user-agent': QIMAO_UA,
            },
        });
        if (response.status === 404) {
            throw new EmptyResultError(label, `Qimao returned 404 for ${url}.`);
        }
        if (!response.ok) {
            throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
        }

        try {
            return normalizeJsonBody(await response.json(), label);
        }
        catch (error) {
            throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
        }
    }
    catch (error) {
        if (page?.evaluate) {
            return qimaoBrowserFetchJson(page, url, label, referer);
        }
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that www.qimao.com is reachable from this network.',
        );
    }
}

export function normalizeCatalogChapter(bookId, chapter) {
    const chapterId = cleanText(chapter?.id);
    return {
        index: Number.parseInt(String(chapter?.index ?? chapter?.chapter_sort ?? ''), 10) || null,
        chapter_id: chapterId,
        title: cleanText(chapter?.title),
        words: Number.parseInt(String(chapter?.words ?? ''), 10) || null,
        is_vip: String(chapter?.is_vip ?? '') === '1',
        updated_at: formatTimestamp(chapter?.update_time),
        url: chapterId ? buildChapterUrl(bookId, chapterId) : '',
    };
}
