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
cli({
    site: 'zhihu',
    name: 'question',
    access: 'read',
    description: '知乎问题详情和回答',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Question ID (numeric)' },
        { name: 'limit', type: 'int', default: 5, help: 'Number of answers' },
    ],
    columns: ['rank', 'author', 'votes', 'content'],
    func: async (page, kwargs) => {
        const { id, limit = 5 } = kwargs;
        const questionId = String(id);
        if (!/^\d+$/.test(questionId)) {
            throw new CliError('INVALID_INPUT', 'Question ID must be numeric', 'Example: opencli zhihu question 123456789');
        }
        const answerLimit = Number(limit);
        await page.goto(`https://www.zhihu.com/question/${questionId}`);
        const url = `https://www.zhihu.com/api/v4/questions/${questionId}/answers?limit=${answerLimit}&offset=0&sort_by=default&include=data[*].content,voteup_count,comment_count,author`;
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
        return (data.data || []).map((item, i) => ({
            rank: i + 1,
            author: item.author?.name || 'anonymous',
            votes: item.voteup_count || 0,
            content: stripHtml(item.content || '').substring(0, 200),
        }));
    },
});
