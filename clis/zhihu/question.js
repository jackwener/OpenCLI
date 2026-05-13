import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
function stripHtml(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
}

const MAX_LIMIT = 1000;

cli({
    site: 'zhihu',
    name: 'question',
    access: 'read',
    description: '知乎问题详情和回答',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Question ID (numeric)' },
        { name: 'limit', type: 'int', default: 5, help: 'Number of answers (max 1000; use normal-sized requests)' },
        { name: 'sort', default: 'default', choices: ['default', 'created'], help: 'Answer order: default or created' },
    ],
    columns: ['rank', 'author', 'votes', 'content'],
    func: async (page, kwargs) => {
        const { id, limit = 5 } = kwargs;
        const questionId = String(id);
        if (!/^\d+$/.test(questionId)) {
            throw new CliError('INVALID_INPUT', 'Question ID must be numeric', 'Example: opencli zhihu question 123456789');
        }
        const answerLimit = Number(limit);
        if (!Number.isInteger(answerLimit) || answerLimit <= 0 || answerLimit > MAX_LIMIT) {
            throw new CliError('INVALID_INPUT', `Limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
        }
        const sort = String(kwargs.sort || 'default');
        if (sort !== 'default' && sort !== 'created') {
            throw new CliError('INVALID_INPUT', 'Sort must be one of: default, created', 'Example: opencli zhihu question 123456789 --sort created');
        }
        await page.goto(sort === 'created'
            ? `https://www.zhihu.com/question/${questionId}/answers/updated`
            : `https://www.zhihu.com/question/${questionId}`);
        // Zhihu caps `limit` at 20 per request, so always ask for the API
        // maximum. The pagination loop below trims to `answerLimit` via the
        // `answers.length >= answerLimit` break, so a smaller --limit only
        // costs one over-fetched page worth of bandwidth and never silently
        // clamps the user-requested count.
        const ZHIHU_PAGE_SIZE = 20;
        let url = `https://www.zhihu.com/api/v4/questions/${questionId}/answers?limit=${ZHIHU_PAGE_SIZE}&offset=0&sort_by=${sort}&include=data[*].content,voteup_count,comment_count,author`;
        const answers = [];
        const seen = new Set();
        const visited = new Set();
        while (url && answers.length < answerLimit && !visited.has(url)) {
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
                    throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch question data from Zhihu');
                }
                throw new CliError('FETCH_ERROR', status ? `Zhihu question answers request failed (HTTP ${status})` : 'Zhihu question answers request failed', 'Try again later or rerun with -v for more detail');
            }
            for (const item of data.data || []) {
                const key = item.id == null ? `${item.author?.name || 'anonymous'}:${item.content || ''}` : String(item.id);
                if (seen.has(key)) continue;
                seen.add(key);
                answers.push(item);
                if (answers.length >= answerLimit) break;
            }
            if (data.paging?.is_end) break;
            url = typeof data.paging?.next === 'string' ? data.paging.next : '';
        }
        return answers.map((item, i) => ({
            rank: i + 1,
            author: item.author?.name || 'anonymous',
            votes: item.voteup_count || 0,
            content: stripHtml(item.content || '').substring(0, 200),
        }));
    },
});
