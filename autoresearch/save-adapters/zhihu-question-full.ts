import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-zhihu',
  name: 'question-full',
  description: '知乎问题 + 回答 + 相关推荐（三层数据合并）',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', type: 'string', default: '19550225', positional: true, help: 'Question ID' },
    { name: 'limit', type: 'int', default: 3, help: 'Number of answers' },
  ],
  columns: ['section', 'title', 'author', 'votes', 'excerpt'],
  func: async (page, kwargs) => {
    const qid = kwargs.id ?? '19550225';
    const limit = kwargs.limit ?? 3;
    // Step 1: Navigate to question page
    await page.goto('https://www.zhihu.com/question/' + qid);
    await page.wait(2);
    // Step 2: Fetch question detail
    const question = await page.evaluate(`(async () => {
      try {
        const res = await fetch('https://www.zhihu.com/api/v4/questions/${qid}', { credentials: 'include' });
        const d = await res.json();
        return { title: d.title || '', follower_count: d.follower_count || 0, answer_count: d.answer_count || 0 };
      } catch { return { title: '', follower_count: 0, answer_count: 0 }; }
    })()`) as any;
    // Step 3: Fetch top answers
    const answers = await page.evaluate(`(async () => {
      const strip = (html) => (html || '').replace(/<[^>]+>/g, '').trim();
      try {
        const res = await fetch('https://www.zhihu.com/api/v4/questions/${qid}/answers?limit=${limit}&offset=0&sort_by=default&include=data[*].content,voteup_count,author', { credentials: 'include' });
        const d = await res.json();
        return (d?.data || []).map(a => ({ author: a.author?.name || 'anonymous', votes: a.voteup_count || 0, excerpt: strip(a.content || '').slice(0, 120) }));
      } catch { return []; }
    })()`) as any[];
    // Step 4: Fetch related questions
    const related = await page.evaluate(`(async () => {
      try {
        const res = await fetch('https://www.zhihu.com/api/v4/questions/${qid}/similar?limit=3', { credentials: 'include' });
        const d = await res.json();
        return (d?.data || []).map(q => ({ title: q.title || '', answer_count: q.answer_count || 0 }));
      } catch { return []; }
    })()`) as any[];
    // Step 5: Merge three layers into unified output
    const rows: any[] = [];
    rows.push({ section: 'question', title: question.title, author: '', votes: question.follower_count, excerpt: question.answer_count + ' answers' });
    for (const a of answers) {
      rows.push({ section: 'answer', title: '', author: a.author, votes: a.votes, excerpt: a.excerpt });
    }
    for (const r of related) {
      rows.push({ section: 'related', title: r.title, author: '', votes: 0, excerpt: r.answer_count + ' answers' });
    }
    return rows;
  },
});
