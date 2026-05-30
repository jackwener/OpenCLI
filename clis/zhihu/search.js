import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { stripHtml } from './text.js';

function itemKey(item) {
    const obj = item.object || {};
    if (obj.id != null) return `${obj.type || ''}:${obj.id}`;
    return null;
}

function itemUrl(obj) {
    const id = obj.id == null ? '' : String(obj.id);
    if (obj.type === 'answer') {
        const questionId = obj.question?.id == null ? '' : String(obj.question.id);
        return questionId && id ? `https://www.zhihu.com/question/${questionId}/answer/${id}` : '';
    }
    if (obj.type === 'article') {
        return id ? `https://zhuanlan.zhihu.com/p/${id}` : '';
    }
    if (obj.type === 'question') {
        return id ? `https://www.zhihu.com/question/${id}` : '';
    }
    return '';
}

function normalizeSearchUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'api.zhihu.com' && parsed.pathname === '/search_v3') {
            return `https://www.zhihu.com/api/v4/search_v3${parsed.search}`;
        }
        if (parsed.hostname === 'www.zhihu.com' && parsed.pathname === '/api/v4/search_v3') {
            return parsed.toString();
        }
    } catch {
        return '';
    }
    return '';
}

const MAX_LIMIT = 1000;
const PAGE_SIZE = 20;
const TYPES = ['all', 'answer', 'article', 'question'];

function parseLimit(value) {
    const limit = Number(value ?? 10);
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new ArgumentError(`zhihu search --limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
    }
    return limit;
}

function requireQuery(value) {
    const query = String(value || '').trim();
    if (!query) {
        throw new ArgumentError('zhihu search query must not be empty', 'Example: opencli zhihu search codex');
    }
    return query;
}

function requireType(value) {
    const type = String(value || 'all');
    if (!TYPES.includes(type)) {
        throw new ArgumentError(`zhihu search --type must be one of: ${TYPES.join(', ')}`, 'Example: opencli zhihu search codex --type answer');
    }
    return type;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

function requireSearchPayload(data, url) {
    const payload = unwrapEvaluateResult(data);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError('Zhihu search returned malformed payload');
    }
    if (payload.__httpError) {
        const status = payload.__httpError;
        if (status === 401 || status === 403) {
            throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch search results from Zhihu');
        }
        throw new CommandExecutionError(`Zhihu search request failed${status ? ` (HTTP ${status})` : ''}`, 'Try again later or rerun with -v for more detail');
    }
    if (payload.__fetchError) {
        throw new CommandExecutionError('Zhihu search request failed', String(payload.__fetchError));
    }
    if (!Array.isArray(payload.data)) {
        throw new CommandExecutionError('Zhihu search returned malformed data list', `URL: ${url}`);
    }
    if (!payload.paging || typeof payload.paging !== 'object') {
        throw new CommandExecutionError('Zhihu search returned malformed paging data', `URL: ${url}`);
    }
    return payload;
}

function normalizeResultItem(item) {
    if (!item || typeof item !== 'object' || item.type !== 'search_result' || !item.object || typeof item.object !== 'object') {
        return null;
    }
    const obj = item.object;
    if (obj.type !== 'answer' && obj.type !== 'article' && obj.type !== 'question') return null;
    const key = itemKey(item);
    const url = itemUrl(obj);
    const question = obj.question || {};
    const title = stripHtml(obj.title || question.name || question.title || '');
    if (!key || !url || !title) {
        throw new CommandExecutionError('Zhihu search returned malformed result row identity');
    }
    return {
        item,
        key,
        row: {
            title,
            type: obj.type,
            author: obj.author?.name || '',
            votes: obj.voteup_count || 0,
            url,
        },
    };
}

cli({
    site: 'zhihu',
    name: 'search',
    access: 'read',
    description: '知乎搜索',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 1000; use normal-sized requests)' },
        { name: 'type', default: 'all', choices: TYPES, help: 'Result type: all, answer, article, or question' },
    ],
    columns: ['rank', 'title', 'type', 'author', 'votes', 'url'],
    func: async (page, kwargs) => {
        const query = requireQuery(kwargs.query);
        const resultLimit = parseLimit(kwargs.limit);
        const type = requireType(kwargs.type);
        await page.goto('https://www.zhihu.com');
        let url = 'https://www.zhihu.com/api/v4/search_v3'
            + `?q=${encodeURIComponent(query)}&t=general&offset=0&limit=${PAGE_SIZE}`;
        const results = [];
        const seen = new Set();
        const visited = new Set();
        while (url && results.length < resultLimit && !visited.has(url)) {
            visited.add(url);
            const data = requireSearchPayload(await page.evaluate(`
      (async () => {
        try {
          const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
          if (!r.ok) return { __httpError: r.status };
          return await r.json();
        } catch (err) {
          return { __fetchError: err?.message || String(err) };
        }
      })()
    `), url);
            for (const item of data.data) {
                const rawType = item?.object?.type;
                if (type !== 'all' && rawType && rawType !== type) continue;
                const normalized = normalizeResultItem(item);
                if (!normalized) continue;
                if (type !== 'all' && normalized.row.type !== type) continue;
                if (seen.has(normalized.key)) continue;
                seen.add(normalized.key);
                results.push(normalized.row);
                if (results.length >= resultLimit) break;
            }
            if (results.length >= resultLimit) break;
            if (data.paging?.is_end) break;
            const next = normalizeSearchUrl(data.paging?.next);
            if (!next) {
                throw new CommandExecutionError('Zhihu search pagination returned malformed next URL');
            }
            if (visited.has(next)) {
                throw new CommandExecutionError('Zhihu search pagination returned a repeated next URL');
            }
            url = next;
        }
        if (results.length === 0) {
            throw new EmptyResultError('zhihu search', `No ${type === 'all' ? '' : `${type} `}results found for "${query}"`);
        }
        return results.map((row, i) => {
            return {
                rank: i + 1,
                ...row,
            };
        });
    },
});

export const __test__ = {
    stripHtml,
    itemKey,
    itemUrl,
    normalizeSearchUrl,
    parseLimit,
    requireQuery,
    requireType,
    unwrapEvaluateResult,
    requireSearchPayload,
    normalizeResultItem,
};
