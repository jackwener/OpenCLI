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
    const answerLimit = Number(limit);

    const stripHtml = (html: string) =>
      (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

    // Only fetch answers here. The question detail endpoint is not used by the
    // current CLI output and can fail independently, which would incorrectly
    // turn a successful answers response into a login error.
    const result = await (page as any).evaluate(
      async ({ questionId, answerLimit }: { questionId: string; answerLimit: number }) => {
        const aResp = await fetch(
          `https://www.zhihu.com/api/v4/questions/${questionId}/answers?limit=${answerLimit}&offset=0&sort_by=default&include=data[*].content,voteup_count,comment_count,author`,
          { credentials: 'include' },
        );
        if (!aResp.ok) return { ok: false as const, status: aResp.status };
        const a = await aResp.json();
        return { ok: true as const, answers: Array.isArray(a?.data) ? a.data : [] };
      },
      { questionId: String(id), answerLimit },
    );

    if (!result?.ok) {
      if (result?.status === 401 || result?.status === 403) {
        throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch question data from Zhihu');
      }
      throw new CliError(
        'FETCH_ERROR',
        `Zhihu question answers request failed with HTTP ${result?.status ?? 'unknown'}`,
        'Try again later or rerun with -v for more detail',
      );
    }

    const answers = result.answers.slice(0, answerLimit).map((a: any, i: number) => ({
      rank: i + 1,
      author: a.author?.name ?? 'anonymous',
      votes: a.voteup_count ?? 0,
      content: stripHtml(a.content ?? '').slice(0, 200),
    }));

    return answers;
  },
});
