import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-zhihu',
  name: 'search-detail',
  description: '知乎搜索 + 每条结果的问题统计',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', type: 'string', default: 'AI', positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 5, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'type', 'author', 'votes', 'answer_count', 'follower_count'],
  func: async (page, kwargs) => {
    const query = kwargs.query ?? 'AI';
    const limit = kwargs.limit ?? 5;
    // Step 1: Navigate
    await page.goto('https://www.zhihu.com');
    await page.wait(2);
    // Step 2: Search API — filter results by type, extract question IDs
    const searchResults = await page.evaluate(`(async () => {
      const strip = (html) => (html || '').replace(/<[^>]+>/g, '').trim();
      const res = await fetch('https://www.zhihu.com/api/v4/search_v3?q=' + encodeURIComponent('${query}') + '&t=general&offset=0&limit=20', { credentials: 'include' });
      const d = await res.json();
      return (d?.data || []).filter(item => item.type === 'search_result').map(item => {
        const obj = item.object || {};
        const q = obj.question || {};
        const questionId = obj.type === 'answer' ? String(q.id || '') : obj.type === 'question' ? String(obj.id || '') : '';
        return { type: obj.type || '', title: strip(obj.title || q.name || ''), author: obj.author?.name || '', votes: obj.voteup_count || 0, questionId };
      });
    })()`) as any[];
    // Step 3: For each result, fetch question stats (answer_count, follower_count)
    const items = searchResults.slice(0, limit);
    const enriched = [];
    for (const item of items) {
      if (!item.questionId) { enriched.push({ ...item, answer_count: 0, follower_count: 0 }); continue; }
      const stats = await page.evaluate(`(async () => {
        try {
          const res = await fetch('https://www.zhihu.com/api/v4/questions/${item.questionId}', { credentials: 'include' });
          const d = await res.json();
          return { answer_count: d.answer_count || 0, follower_count: d.follower_count || 0 };
        } catch { return { answer_count: 0, follower_count: 0 }; }
      })()`) as any;
      enriched.push({ ...item, answer_count: stats.answer_count, follower_count: stats.follower_count });
    }
    // Step 4: Format output
    return enriched.map((item, i) => ({
      rank: i + 1, title: item.title, type: item.type, author: item.author,
      votes: item.votes, answer_count: item.answer_count, follower_count: item.follower_count,
    }));
  },
});
