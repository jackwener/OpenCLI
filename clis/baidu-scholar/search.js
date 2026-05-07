import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';

cli({
    site: 'baidu-scholar',
    name: 'search',
    access: 'read',
    description: '百度学术搜索',
    domain: 'xueshu.baidu.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'authors', 'journal', 'year', 'cited', 'url'],
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://xueshu.baidu.com/s?wd=${encodeURIComponent(query)}&pn=0&tn=SE_baiduxueshu_c1gjeupa`);
        await page.wait(5);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 20; i++) {
          if (document.querySelectorAll('.result').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const results = [];
        for (const el of document.querySelectorAll('.result')) {
          const titleEl = el.querySelector('h3 a, .paper-title a, .t a');
          const title = normalize(titleEl?.textContent);
          if (!title) continue;

          let url = titleEl?.getAttribute('href') || '';
          if (url && !url.startsWith('http')) url = 'https://xueshu.baidu.com' + url;

          const infoEl = el.querySelector('.paper-info');
          const infoText = normalize(infoEl?.textContent);
          const spans = infoEl ? Array.from(infoEl.querySelectorAll('span')) : [];

          let journal = '';
          let year = '';
          let cited = '0';
          const authorParts = [];

          for (const span of spans) {
            const text = normalize(span.textContent);
            if (!text || text === '，' || text === ',') continue;
            if (text.startsWith('《') || text.startsWith('〈')) {
              journal = text.replace(/[《》〈〉]/g, '');
              continue;
            }
            if (/^被引量[：:]/.test(text)) {
              cited = text.match(/(\\d+)/)?.[1] || '0';
              continue;
            }
            if (/^-\\s*(\\d{4})/.test(text) || /^\\d{4}年?$/.test(text)) {
              year = text.match(/(\\d{4})/)?.[1] || '';
              continue;
            }
            if (!journal && !/^被引/.test(text) && !text.startsWith('-')) {
              authorParts.push(text);
            }
          }

          if (!year) year = infoText.match(/(19|20)\\d{2}/)?.[0] || '';
          if (!cited || cited === '0') cited = infoText.match(/被引量[：:]\\s*(\\d+)/)?.[1] || '0';

          results.push({
            rank: results.length + 1,
            title,
            authors: authorParts.join(', ').slice(0, 80),
            journal,
            year,
            cited,
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
