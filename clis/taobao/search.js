import { AuthRequiredError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';
cli({
    site: 'taobao',
    name: 'search',
    access: 'read',
    description: '淘宝商品搜索',
    domain: 's.taobao.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'sort', default: 'default', choices: ['default', 'sale', 'price'], help: '排序 (default/sale销量/price价格)' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 40)' },
    ],
    columns: ['rank', 'title', 'price', 'sales', 'shop', 'location', 'item_id', 'url'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 40);
        const query = requireNonEmptyQuery(kwargs.query);
        const sortMap = { default: '', sale: '&sort=sale-desc', price: '&sort=price-asc' };
        const sortParam = sortMap[String(kwargs.sort || 'default')] || '';
        await page.goto('https://www.taobao.com');
        await page.wait(2);
        await page.evaluate(`location.href = ${JSON.stringify(`https://s.taobao.com/search?q=${encodeURIComponent(query)}${sortParam}`)}`);
        await page.wait(8);
        await page.autoScroll({ times: 3, delayMs: 2000 });
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const bodyText = document.body?.innerText || '';
        if (bodyText.length < 1000 && bodyText.includes('请登录')) {
          return { error: 'auth-required' };
        }

        for (let i = 0; i < 30; i++) {
          if (document.querySelectorAll('[class*="doubleCard--"]').length > 3) break;
          await new Promise(r => setTimeout(r, 500));
        }

        const cards = document.querySelectorAll('[class*="doubleCard--"]');
        const results = [];
        const seenTitles = new Set();

        for (const card of cards) {
          const titleEl = card.querySelector('[class*="title--"]');
          const title = titleEl ? normalize(titleEl.textContent) : '';
          if (!title || title.length < 3 || seenTitles.has(title)) continue;
          seenTitles.add(title);

          const intEl = card.querySelector('[class*="priceInt--"]');
          const floatEl = card.querySelector('[class*="priceFloat--"]');
          let price = '';
          if (intEl) {
            price = '¥' + normalize(intEl.textContent) + (floatEl ? normalize(floatEl.textContent) : '');
          }

          const salesEl = card.querySelector('[class*="realSales--"]');
          const sales = salesEl ? normalize(salesEl.textContent) : '';

          const shopEl = card.querySelector('[class*="shopName--"]');
          let shop = shopEl ? normalize(shopEl.textContent) : '';
          shop = shop.replace(/^\\d+年老店/, '').replace(/^回头客[\\d万]+/, '');

          const locEls = card.querySelectorAll('[class*="procity--"]');
          const location = Array.from(locEls).map(el => normalize(el.textContent)).join('');

          let itemId = '';
          let wrapper = card.parentElement;
          for (let i = 0; i < 3 && wrapper; i++) {
            const spmId = wrapper.getAttribute('data-spm-act-id');
            if (spmId && /^\\d{10,}$/.test(spmId)) { itemId = spmId; break; }
            wrapper = wrapper.parentElement;
          }

          results.push({
            rank: results.length + 1,
            title: title.slice(0, 80),
            price,
            sales,
            shop,
            location,
            item_id: itemId,
            url: itemId ? 'https://item.taobao.com/item.htm?id=' + itemId : '',
          });
          if (results.length >= ${limit}) break;
        }

        return { results };
      })()
    `);
        if (data?.error === 'auth-required') {
            throw new AuthRequiredError('taobao search requires a logged-in Taobao session');
        }
        return Array.isArray(data?.results) ? data.results : [];
    },
});
