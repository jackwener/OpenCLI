import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';

cli({
    site: 'wanfang',
    name: 'search',
    access: 'read',
    description: '万方数据论文搜索',
    domain: 's.wanfangdata.com.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'authors', 'source', 'year', 'type', 'cited', 'url'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(query)}`);
        await page.wait(5);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 30; i++) {
          if (document.querySelectorAll('span.title').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const results = [];
        for (const titleSpan of document.querySelectorAll('span.title')) {
          const title = normalize(titleSpan.textContent);
          if (!title || title.length < 3) continue;

          let container = titleSpan.parentElement;
          for (let i = 0; i < 6; i++) {
            if (!container?.parentElement || container.parentElement.tagName === 'BODY') break;
            if (container.querySelectorAll('span.title').length >= 1 && container.querySelectorAll('span.authors').length >= 1) break;
            container = container.parentElement;
          }
          if (!container) continue;

          const id = normalize(container.querySelector('span.title-id-hidden')?.textContent);
          const url = id ? 'https://d.wanfangdata.com.cn/' + id : '';
          const authors = Array.from(container.querySelectorAll('span.authors'))
            .map((item) => normalize(item.textContent))
            .filter(Boolean)
            .join(', ')
            .slice(0, 80);
          const type = normalize(container.querySelector('span.essay-type')?.textContent);
          const source = normalize(container.querySelector('span.periodical, span.source')?.textContent);

          let year = normalize(container.querySelector('span.year, span.date')?.textContent);
          if (!year) year = (container.textContent || '').match(/(19|20)\\d{2}/)?.[0] || '';

          const citedText = normalize(container.querySelector('.stat-item.quote, [class*=\"quote\"]')?.textContent);
          const cited = citedText.match(/(\\d+)/)?.[1] || '0';

          results.push({ rank: results.length + 1, title, authors, source, year, type, cited, url });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
