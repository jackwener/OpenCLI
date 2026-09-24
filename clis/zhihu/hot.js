import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const MAX_LIMIT = 50;

export function normalizeHotItem(item) {
    if (!item) return null;
    const t = item.target || {};
    const cardId = item.card_id || '';
    let questionId = t.id != null ? String(t.id) : '';
    if (!questionId && cardId.startsWith('Q_')) {
        questionId = cardId.slice(2);
    }
    const title = t.title || t.question?.title || item.title || '';
    if (!title) return null;

    let url = '';
    if (t.type === 'article' && (t.id != null || cardId.startsWith('A_'))) {
        const articleId = t.id != null ? String(t.id) : cardId.slice(2);
        url = `https://zhuanlan.zhihu.com/p/${articleId}`;
    } else if (questionId) {
        url = `https://www.zhihu.com/question/${questionId}`;
    } else if (typeof t.url === 'string' && t.url.startsWith('http')) {
        url = t.url;
    } else if (typeof item.link_url === 'string' && item.link_url.startsWith('http')) {
        url = item.link_url;
    }

    const heat = item.detail_text || (t.metrics?.heat ? `${t.metrics.heat} 万热度` : '') || '';
    const answers = t.answer_count ?? 0;

    return {
        title,
        heat,
        answers,
        url,
    };
}

export function parseHotLimit(value) {
    const limit = Number(value ?? 20);
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new ArgumentError(`zhihu hot --limit must be a positive integer no greater than ${MAX_LIMIT}`, `Example: opencli zhihu hot --limit 20`);
    }
    return limit;
}

cli({
    site: 'zhihu',
    name: 'hot',
    access: 'read',
    description: '知乎热榜',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return (1-50)' },
    ],
    columns: ['rank', 'title', 'heat', 'answers', 'url'],
    func: async (page, kwargs) => {
        const resultLimit = parseHotLimit(kwargs.limit);
        await page.goto('https://www.zhihu.com');
        const data = await page.evaluate(`
            (async () => {
                try {
                    const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', {
                        credentials: 'include'
                    });
                    if (!res.ok) return { __httpError: res.status };
                    const text = await res.text();
                    return JSON.parse(
                        text.replace(/("id"\\s*:\\s*)(\\d{16,})/g, '$1"$2"')
                    );
                } catch (err) {
                    return { __fetchError: err?.message || String(err) };
                }
            })()
        `);

        if (!data || data.__httpError) {
            const status = data?.__httpError;
            if (status === 401 || status === 403) {
                throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu hot list');
            }
            throw new CommandExecutionError(
                status ? `Zhihu hot list request failed (HTTP ${status})` : 'Zhihu hot list request failed',
                'Try again later or rerun with -v for more detail'
            );
        }

        if (data.__fetchError) {
            throw new CommandExecutionError('Zhihu hot list request failed', String(data.__fetchError));
        }

        const items = data.data || [];
        const results = [];
        for (const item of items) {
            const normalized = normalizeHotItem(item);
            if (!normalized) continue;
            results.push(normalized);
            if (results.length >= resultLimit) break;
        }

        if (results.length === 0) {
            throw new EmptyResultError('zhihu hot', 'No items found in Zhihu hot list');
        }

        return results.map((row, i) => ({
            rank: i + 1,
            ...row,
        }));
    },
});

export const __test__ = {
    normalizeHotItem,
    parseHotLimit,
};
