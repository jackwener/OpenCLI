import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, CliError } from '../../errors.js';

cli({
  site: 'zhihu',
  name: 'question',
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
    const result: any = await page.evaluate(`(async () => {
      const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
      try {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        if (!r.ok) return { ok: false, status: r.status };
        const a = await r.json();
        const answers = (a?.data || []).map((item, i) => ({
          rank: i + 1,
          author: item.author?.name || 'anonymous',
          votes: item.voteup_count || 0,
          content: strip(item.content || '').substring(0, 200),
        }));
        return { ok: true, answers };
      } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      }
    })()`);

    if (!result?.ok) {
      if (result?.status === 401 || result?.status === 403) {
        throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch question data from Zhihu');
      }
      const detail = result?.status > 0 ? ` with HTTP ${result.status}` : (result?.error ? `: ${result.error}` : '');
      throw new CliError(
        'FETCH_ERROR',
        `Zhihu question answers request failed${detail}`,
        'Try again later or rerun with -v for more detail',
      );
    }

    return result.answers;
  },
});
