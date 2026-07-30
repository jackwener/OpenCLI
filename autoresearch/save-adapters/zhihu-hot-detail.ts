import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-zhihu',
  name: 'hot-detail',
  description: '知乎热榜 + 每个问题的第一个回答摘要',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 5, help: 'Number of items' },
  ],
  columns: ['rank', 'title', 'heat', 'top_answer_author', 'top_answer_excerpt'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit ?? 5;
    // Step 1: Navigate
    await page.goto('https://www.zhihu.com');
    await page.wait(2);
    // Step 2: Fetch hot list (handle 16+ digit IDs)
    const hotList = await page.evaluate(`(async () => {
      const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', { credentials: 'include' });
      const text = await res.text();
      const d = JSON.parse(text.replace(/("id"\\s*:\\s*)(\\d{16,})/g, '$1"$2"'));
      return (d?.data || []).map(item => {
        const t = item.target || {};
        return { qid: String(t.id || ''), title: t.title || '', heat: item.detail_text || '' };
      });
    })()`) as any[];
    // Step 3: For each hot question, fetch its top answer
    const items = hotList.slice(0, limit);
    const enriched = [];
    for (const item of items) {
      if (!item.qid) { enriched.push({ ...item, top_answer_author: '', top_answer_excerpt: '' }); continue; }
      const answer = await page.evaluate(`(async () => {
        const strip = (html) => (html || '').replace(/<[^>]+>/g, '').trim();
        try {
          const res = await fetch('https://www.zhihu.com/api/v4/questions/${item.qid}/answers?limit=1&offset=0&sort_by=default&include=data[*].content,voteup_count,author', { credentials: 'include' });
          const d = await res.json();
          const a = d?.data?.[0];
          if (!a) return { author: '', excerpt: '' };
          return { author: a.author?.name || 'anonymous', excerpt: strip(a.content || '').slice(0, 120) };
        } catch { return { author: '', excerpt: '' }; }
      })()`) as any;
      enriched.push({ ...item, top_answer_author: answer.author, top_answer_excerpt: answer.excerpt });
    }
    // Step 4: Format output
    return enriched.map((item, i) => ({
      rank: i + 1, title: item.title, heat: item.heat,
      top_answer_author: item.top_answer_author, top_answer_excerpt: item.top_answer_excerpt,
    }));
  },
});
