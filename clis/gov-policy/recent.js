import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt } from '../_shared/common.js';

cli({
    site: 'gov-policy',
    name: 'recent',
    access: 'read',
    description: '国务院最新政策文件',
    domain: 'www.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'date', 'source', 'url'],
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        await page.goto('https://www.gov.cn/zhengce/zuixin/index.htm');
        await page.wait(4);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 20; i++) {
          if (document.querySelector('.news_box li, .list li, .list_item, .news-list li')) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const results = [];
        for (const el of document.querySelectorAll('.news_box li, .list li, .list_item, .news-list li')) {
          const titleEl = el.querySelector('a');
          const title = normalize(titleEl?.textContent);
          if (!title || title.length < 4) continue;

          let url = titleEl?.getAttribute('href') || '';
          if (url && !url.startsWith('http')) url = 'https://www.gov.cn' + url;

          const date = (el.textContent || '').match(/(\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})/)?.[1] || '';
          const source = normalize(el.querySelector('.source, .from')?.textContent);

          results.push({ rank: results.length + 1, title, date, source, url });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
