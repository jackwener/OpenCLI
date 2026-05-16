import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

function normalizeUrl(item) {
    const target = item.target || {};
    const id = target.id == null ? '' : String(target.id);
    if (target.type === 'answer') {
        const questionId = target.question?.id == null ? '' : String(target.question.id);
        return questionId && id ? `https://www.zhihu.com/question/${questionId}/answer/${id}` : '';
    }
    if (target.type === 'article') {
        return id ? `https://zhuanlan.zhihu.com/p/${id}` : '';
    }
    if (target.type === 'question') {
        return id ? `https://www.zhihu.com/question/${id}` : '';
    }
    return '';
}

function normalizeTitle(item) {
    const target = item.target || {};
    if (target.type === 'answer') return target.question?.title || '';
    return target.title || target.question?.title || '';
}

const MAX_LIMIT = 1000;

cli({
    site: 'zhihu',
    name: 'recommend',
    access: 'read',
    description: '知乎首页推荐',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return (max 1000; use normal-sized requests)' },
    ],
    columns: ['rank', 'type', 'title', 'author', 'votes', 'url'],
    func: async (page, kwargs) => {
        const itemLimit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(itemLimit) || itemLimit <= 0 || itemLimit > MAX_LIMIT) {
            throw new CliError('INVALID_INPUT', `Limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
        }
        await page.goto('https://www.zhihu.com');
        let url = 'https://www.zhihu.com/api/v3/feed/topstory/recommend?limit=10&desktop=true';
        const items = [];
        const seen = new Set();
        const visited = new Set();
        while (url && items.length < itemLimit && !visited.has(url)) {
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
                    throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu recommendations');
                }
                throw new CliError('FETCH_ERROR', status ? `Zhihu recommendations request failed (HTTP ${status})` : 'Zhihu recommendations request failed', 'Try again later or rerun with -v for more detail');
            }
            for (const item of data.data || []) {
                const target = item.target || {};
                // Dedup key uses semantic identity (type:targetId) and falls
                // back to the feed cursor id when no target id exists. We avoid
                // synthesizing a sentinel like 'unknown' for missing type
                // because that would collapse distinct typed items into the
                // same bucket. When no id is available at all we keep the row
                // and skip dedup — surfacing potentially-duplicate items beats
                // silently dropping them.
                const targetId = target.id;
                let key = null;
                if (targetId != null) {
                    key = `${target.type ?? ''}:${targetId}`;
                } else if (item.id != null) {
                    key = `__feed:${item.id}`;
                }
                if (key != null) {
                    if (seen.has(key)) continue;
                    seen.add(key);
                }
                items.push(item);
                if (items.length >= itemLimit) break;
            }
            if (data.paging?.is_end) break;
            url = typeof data.paging?.next === 'string' ? data.paging.next : '';
        }
        return items.map((item, i) => {
            const target = item.target || {};
            return {
                rank: i + 1,
                type: target.type || item.type || '',
                title: normalizeTitle(item),
                author: target.author?.name || '',
                votes: target.voteup_count ?? target.reaction?.statistics?.like_count ?? 0,
                url: normalizeUrl(item),
            };
        });
    },
});
