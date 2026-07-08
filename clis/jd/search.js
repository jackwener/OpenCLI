import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';
cli({
    site: 'jd',
    name: 'search',
    access: 'read',
    description: '京东商品搜索',
    domain: 'search.jd.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 30)' },
    ],
    columns: ['rank', 'title', 'price', 'shop', 'sku', 'url'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 30);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://search.jd.com/Search?keyword=${encodeURIComponent(query)}&enc=utf-8`);
        await page.wait(5);
        await page.autoScroll({ times: 2, delayMs: 1500 });
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 20; i++) {
          if (document.querySelectorAll('div[data-sku]').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const items = document.querySelectorAll('div[data-sku]');
        const results = [];
        for (const el of items) {
          const sku = el.getAttribute('data-sku') || '';
          if (!sku) continue;
          const text = normalize(el.textContent);
          if (text.length < 10) continue;

          const priceMatch = text.match(/¥([\\d,.]+)/);
          const price = priceMatch ? '¥' + priceMatch[1] : '';

          let title = '';
          if (priceMatch) {
            const beforePrice = text.substring(0, text.indexOf('¥'));
            title = beforePrice.replace(/^(海外无货|京东超市|自营|秒杀|新品|预售|PLUS)/, '').trim();
          }
          if (!title || title.length < 4) continue;

          let shop = '';
          const shopMatch = text.match(/(\\S{2,15}(?:旗舰店|专卖店|自营店|官方旗舰店|京东自营旗舰店|京东自营))/);
          if (shopMatch) shop = shopMatch[1];

          results.push({
            rank: results.length + 1,
            title: title.slice(0, 80),
            price,
            shop,
            sku,
            url: 'https://item.jd.com/' + sku + '.html',
          });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
