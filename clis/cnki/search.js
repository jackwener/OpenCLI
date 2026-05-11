import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';
cli({
    site: 'cnki',
    name: 'search',
    access: 'read',
    description: '中国知网论文搜索（海外版）',
    domain: 'oversea.cnki.net',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'authors', 'journal', 'date', 'url'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://oversea.cnki.net/kns/search?dbcode=CFLS&kw=${encodeURIComponent(query)}&korder=SU`);
        await page.wait(8);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('.result-table-list tbody tr, #gridTable tbody tr')) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const rows = document.querySelectorAll('.result-table-list tbody tr, #gridTable tbody tr');
        const results = [];
        for (const row of rows) {
          const tds = row.querySelectorAll('td');
          if (tds.length < 5) continue;

          const nameCell = row.querySelector('td.name') || tds[2];
          const titleEl = nameCell?.querySelector('a');
          const title = normalize(titleEl?.textContent).replace(/免费$/, '');
          if (!title) continue;

          let url = titleEl?.getAttribute('href') || '';
          if (url && !url.startsWith('http')) url = 'https://oversea.cnki.net' + url;

          const authorCell = row.querySelector('td.author') || tds[3];
          const journalCell = row.querySelector('td.source') || tds[4];
          const dateCell = row.querySelector('td.date') || tds[5];

          results.push({
            rank: results.length + 1,
            title,
            authors: normalize(authorCell?.textContent),
            journal: normalize(journalCell?.textContent),
            date: normalize(dateCell?.textContent),
            url,
          });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
