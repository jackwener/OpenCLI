// Shared helpers for the Juejin (`api.juejin.cn`) adapter.
//
// Juejin is a Chinese developer community (similar to Dev.to). The public
// REST API is unauthenticated; all read endpoints are reachable without a
// browser session. Article URLs round-trip as `https://juejin.cn/post/<id>`.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const JUEJIN_API_BASE = 'https://api.juejin.cn';
export const JUEJIN_POST_URL = 'https://juejin.cn/post';
export const JUEJIN_USER_URL = 'https://juejin.cn/user';
const UA = 'opencli-juejin-adapter (+https://github.com/jackwener/opencli)';

// Juejin content / article IDs are 19-digit numeric strings.
const JUEJIN_ID = /^\d{16,20}$/;

// Top-level categories surfaced by `query_category_briefs`. The slugs are
// stable so the adapter accepts a friendly name in addition to the raw id.
export const CATEGORY_ALIASES = {
    backend: '6809637769959178254',
    frontend: '6809637767543259144',
    android: '6809635626879549454',
    ios: '6809635626661445640',
    ai: '6809637773935378440',
};

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(`juejin ${label} cannot be empty`);
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    let n;
    if (typeof raw === 'number') {
        n = raw;
    }
    else if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) {
        n = Number(raw);
    }
    else {
        throw new ArgumentError(`juejin ${label} must be a positive decimal integer`);
    }
    if (!Number.isSafeInteger(n) || n <= 0) {
        throw new ArgumentError(`juejin ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`juejin ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireCursor(value) {
    const raw = value ?? '0';
    if (typeof raw === 'number') {
        if (Number.isSafeInteger(raw) && raw >= 0) return String(raw);
        throw new ArgumentError('juejin cursor must be a non-negative decimal integer');
    }
    if (typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw)) {
        return raw;
    }
    throw new ArgumentError('juejin cursor must be a non-negative decimal integer');
}

/** Resolve a `--category` arg to the underlying numeric category id. */
export function resolveCategory(value) {
    if (value == null) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (JUEJIN_ID.test(raw)) return raw;
    const slug = raw.toLowerCase();
    if (CATEGORY_ALIASES[slug]) return CATEGORY_ALIASES[slug];
    throw new ArgumentError(
        `juejin category "${value}" is not recognised`,
        `Use a category id (e.g. "${CATEGORY_ALIASES.backend}") or one of: ${Object.keys(CATEGORY_ALIASES).join(', ')}.`,
    );
}

/**
 * POST JSON to a Juejin endpoint. The API returns `{ err_no, err_msg, data }`;
 * a non-zero `err_no` is surfaced as a typed `CommandExecutionError`.
 */
export async function juejinFetch(path, body, label, method = 'POST') {
    const url = `${JUEJIN_API_BASE}${path}`;
    let resp;
    try {
        const init = {
            method,
            headers: { 'user-agent': UA, accept: 'application/json' },
        };
        if (method === 'POST') {
            init.headers['content-type'] = 'application/json';
            init.body = JSON.stringify(body ?? {});
        }
        resp = await fetch(url, init);
    } catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.juejin.cn is reachable from this network.',
        );
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Juejin throttles bursty traffic; wait a few seconds and retry.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let payload;
    try {
        payload = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'err_no')) {
        throw new CommandExecutionError(`${label} returned a malformed API envelope`);
    }
    if (payload.err_no !== 0) {
        throw new CommandExecutionError(`${label} returned err_no ${payload.err_no}: ${payload.err_msg ?? ''}`);
    }
    return payload;
}

export function readDataArray(payload, label) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'data')) {
        throw new CommandExecutionError(`${label} returned a malformed payload`);
    }
    if (!Array.isArray(payload.data)) {
        throw new CommandExecutionError(`${label} returned a non-array data field`);
    }
    if (payload.data.length === 0) {
        throw new EmptyResultError(label, `${label} returned no articles.`);
    }
    return payload.data;
}

function readArticleId(value, label) {
    const id = String(value ?? '').trim();
    if (!JUEJIN_ID.test(id)) {
        throw new CommandExecutionError(`${label} returned a malformed article id`);
    }
    return id;
}

function readOptionalNumber(value, label) {
    if (value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new CommandExecutionError(`${label} returned a malformed numeric field`);
    }
    return n;
}

/** Map a recommend-feed row (`item_info.article_info` / `author_user_info`) to a flat shape. */
export function mapFeedItem(row, rank) {
    const info = row?.item_info ?? {};
    const article = info.article_info ?? {};
    const author = info.author_user_info ?? {};
    const tags = Array.isArray(info.tags)
        ? info.tags.map(t => t?.tag_name).filter(Boolean).slice(0, 6).join(', ')
        : '';
    const articleId = readArticleId(article.article_id, 'juejin recommend');
    return {
        rank,
        article_id: articleId,
        title: String(article.title ?? '').trim(),
        brief: String(article.brief_content ?? '').trim(),
        views: readOptionalNumber(article.view_count, 'juejin recommend'),
        likes: readOptionalNumber(article.digg_count, 'juejin recommend'),
        comments: readOptionalNumber(article.comment_count, 'juejin recommend'),
        author: String(author.user_name ?? '').trim(),
        tags,
        url: articleId ? `${JUEJIN_POST_URL}/${articleId}` : '',
    };
}

/** Map a hot-list row (different envelope from the feed endpoint) to the same flat shape. */
export function mapHotItem(row, rank) {
    const content = row?.content ?? {};
    const counter = row?.content_counter ?? {};
    const author = row?.author ?? {};
    const articleId = readArticleId(content.content_id, 'juejin hot');
    return {
        rank,
        article_id: articleId,
        title: String(content.title ?? '').trim(),
        brief: String(content.brief ?? '').trim(),
        views: readOptionalNumber(counter.view, 'juejin hot'),
        likes: readOptionalNumber(counter.like, 'juejin hot'),
        comments: readOptionalNumber(counter.comment_count, 'juejin hot'),
        hot_rank: readOptionalNumber(counter.hot_rank, 'juejin hot'),
        author: String(author.name ?? '').trim(),
        url: articleId ? `${JUEJIN_POST_URL}/${articleId}` : '',
    };
}
