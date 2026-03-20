import { cli, Strategy } from '../../registry.js';

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

    const stripHtml = (html: string) =>
      (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

    // Fetch question detail and answers in parallel via evaluate
    const result = await page.evaluate(`
      async () => {
        const [qResp, aResp] = await Promise.all([
          fetch('https://www.zhihu.com/api/v4/questions/${id}?include=data[*].detail,excerpt,answer_count,follower_count,visit_count', {credentials: 'include'}),
          fetch('https://www.zhihu.com/api/v4/questions/${id}/answers?limit=${limit}&offset=0&sort_by=default&include=data[*].content,voteup_count,comment_count,author', {credentials: 'include'})
        ]);
        if (!qResp.ok || !aResp.ok) return { error: true };
        const q = await qResp.json();
        const a = await aResp.json();
        return { question: q, answers: a.data || [] };
      }
    `);

    if (!result || result.error) throw new Error('Failed to fetch question. Are you logged in?');

    const answers = (result.answers ?? []).slice(0, Number(limit)).map((a: any, i: number) => ({
      rank: i + 1,
      author: a.author?.name ?? 'anonymous',
      votes: a.voteup_count ?? 0,
      content: stripHtml(a.content ?? '').slice(0, 200),
    }));

    return answers;
  },
});
