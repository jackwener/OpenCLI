import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';

cli({
    site: 'gov-policy',
    name: 'search',
    access: 'read',
    description: '中国政府网政策文件搜索',
    domain: 'sousuo.www.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'description', 'date', 'url'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://sousuo.www.gov.cn/sousuo/search.shtml?code=17da70961a7&dataTypeId=107&searchWord=${encodeURIComponent(query)}`);
        await page.wait(5);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 30; i++) {
          if (document.querySelectorAll('.basic_result_content .item, .js_basic_result_content .item').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const results = [];
        for (const el of document.querySelectorAll('.basic_result_content .item, .js_basic_result_content .item')) {
          const titleEl = el.querySelector('a.title, .title a, a.log-anchor');
          const title = normalize(titleEl?.textContent).replace(/<[^>]+>/g, '');
          if (!title || title.length < 4) continue;

          let url = titleEl?.getAttribute('href') || '';
          if (url && !url.startsWith('http')) url = 'https://www.gov.cn' + url;

          const description = normalize(el.querySelector('.description')?.textContent).slice(0, 120);
          const date = (el.textContent || '').match(/(\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})/)?.[1] || '';
          results.push({ rank: results.length + 1, title, description, date, url });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
