import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, normalizeNumericId } from '../_shared/common.js';
cli({
    site: 'taobao',
    name: 'reviews',
    description: '淘宝商品评价',
    domain: 'item.taobao.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: '商品 ID' },
        { name: 'limit', type: 'int', default: 10, help: '返回评价数量 (max 20)' },
    ],
    columns: ['rank', 'user', 'content', 'date', 'spec'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const itemId = normalizeNumericId(kwargs.id, 'id', '827563850178');
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        await page.goto('https://www.taobao.com');
        await page.wait(2);
        await page.evaluate(`location.href = ${JSON.stringify(`https://item.taobao.com/item.htm?id=${itemId}`)}`);
        await page.wait(6);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        let sellerId = '';
        const pageText = document.documentElement.innerHTML || '';
        const sellerMatch = pageText.match(/sellerId['":\\s]+['"]?(\\d+)/) || pageText.match(/userId['":\\s]+['"]?(\\d+)/) || pageText.match(/shopId['":\\s]+['"]?(\\d+)/);
        if (sellerMatch) sellerId = sellerMatch[1];

        if (!sellerId) {
          const shopLink = document.querySelector('a[href*="shopId="], a[href*="seller_id="], a[href*="userId="]');
          const href = shopLink?.getAttribute('href') || '';
          const m = href.match(/(?:shopId|seller_id|userId)=(\\d+)/);
          if (m) sellerId = m[1];
        }

        const url = 'https://rate.tmall.com/list_detail_rate.htm?itemId=' + ${JSON.stringify(itemId)}
          + (sellerId ? '&sellerId=' + sellerId : '')
          + '&order=3&currentPage=1&append=0&content=1&tagId=&posi=&picture=&groupValue=&needFold=0&_ksTS=' + Date.now();

        try {
          const results = await new Promise((resolve) => {
            const cbName = '_ocli_rate_' + Date.now();
            let settled = false;
            const cleanup = (value) => {
              if (settled) return;
              settled = true;
              delete window[cbName];
              script.remove();
              resolve(value);
            };
            window[cbName] = (payload) => {
              const list = payload?.rateDetail?.rateList || [];
              cleanup(list.slice(0, ${limit}).map((item, i) => ({
                rank: i + 1,
                user: (item.displayUserNick || item.userNick || '').slice(0, 15),
                content: normalize(item.rateContent || '').slice(0, 150),
                date: (item.rateDate || '').slice(0, 10),
                spec: normalize(item.auctionSku || '').slice(0, 40),
              })));
            };
            const script = document.createElement('script');
            script.src = url + '&callback=' + cbName;
            script.onerror = () => cleanup([]);
            document.head.appendChild(script);
            setTimeout(() => cleanup([]), 10000);
          });
          if (results.length > 0) return results;
        } catch {}

        return [];
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
