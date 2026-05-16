import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

function stripHtml(html) {
    return (html || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/<em>/g, '')
        .replace(/<\/em>/g, '')
        .trim();
}

function itemKey(item) {
    const obj = item.object || {};
    if (obj.id != null) return `${obj.type || ''}:${obj.id}`;
    if (item.index != null) return `index:${item.index}`;
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
    } catch {
        return '';
    }
    return url;
}

const MAX_LIMIT = 1000;
const PAGE_SIZE = 20;
const TYPES = ['all', 'answer', 'article', 'question'];

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
        const query = String(kwargs.query || '').trim();
        if (!query) {
            throw new CliError('INVALID_INPUT', 'Search query must not be empty', 'Example: opencli zhihu search codex');
        }
        const resultLimit = Number(kwargs.limit ?? 10);
        if (!Number.isInteger(resultLimit) || resultLimit <= 0 || resultLimit > MAX_LIMIT) {
            throw new CliError('INVALID_INPUT', `Limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
        }
        const type = String(kwargs.type || 'all');
        if (!TYPES.includes(type)) {
            throw new CliError('INVALID_INPUT', `Type must be one of: ${TYPES.join(', ')}`, 'Example: opencli zhihu search codex --type answer');
        }
        await page.goto('https://www.zhihu.com');
        let url = 'https://www.zhihu.com/api/v4/search_v3'
            + `?q=${encodeURIComponent(query)}&t=general&offset=0&limit=${PAGE_SIZE}`;
        const results = [];
        const seen = new Set();
        const visited = new Set();
        while (url && results.length < resultLimit && !visited.has(url)) {
            visited.add(url);
            const data = await page.evaluate(`
      (async () => {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        return await r.json();
      })()
    `);
            if (!data || data.__httpError) {
                const status = data?.__httpError;
                if (status === 401 || status === 403) {
                    throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch search results from Zhihu');
                }
                throw new CliError('FETCH_ERROR', status ? `Zhihu search request failed (HTTP ${status})` : 'Zhihu search request failed', 'Try again later or rerun with -v for more detail');
            }
            for (const item of data.data || []) {
                const obj = item.object || {};
                if (item.type !== 'search_result') continue;
                if (obj.type !== 'answer' && obj.type !== 'article' && obj.type !== 'question') continue;
                if (type !== 'all' && obj.type !== type) continue;
                const key = itemKey(item);
                if (key != null) {
                    if (seen.has(key)) continue;
                    seen.add(key);
                }
                results.push(item);
                if (results.length >= resultLimit) break;
            }
            if (data.paging?.is_end) break;
            url = normalizeSearchUrl(data.paging?.next);
        }
        return results.map((item, i) => {
            const obj = item.object || {};
            const question = obj.question || {};
            return {
                rank: i + 1,
                title: stripHtml(obj.title || question.name || question.title || ''),
                type: obj.type || '',
                author: obj.author?.name || '',
                votes: obj.voteup_count || 0,
                url: itemUrl(obj),
            };
        });
    },
});
