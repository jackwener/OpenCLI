import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, normalizeNumericId } from '../_shared/common.js';
cli({
    site: 'jd',
    name: 'reviews',
    description: '京东商品评价',
    domain: 'item.jd.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'sku', positional: true, required: true, help: '商品 SKU ID' },
        { name: 'limit', type: 'int', default: 10, help: '返回评价数量 (max 20)' },
    ],
    columns: ['rank', 'user', 'content', 'date'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const sku = normalizeNumericId(kwargs.sku, 'sku', '100291143898');
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        await page.goto(`https://item.jd.com/${sku}.html`);
        await page.wait(5);
        await page.autoScroll({ times: 2, delayMs: 1500 });
        const data = await page.evaluate(`
      (async () => {
        const text = document.body?.innerText || '';
        const reviewStart = text.indexOf('买家评价');
        const reviewEnd = text.indexOf('全部评价');
        if (reviewStart < 0) return [];

        const reviewSection = text.substring(reviewStart, reviewEnd > reviewStart ? reviewEnd : reviewStart + 3000);
        const lines = reviewSection.split('\\n').map(l => l.trim()).filter(Boolean);

        const results = [];
        const userPattern = /^[a-zA-Z0-9*_]{3,15}$/;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (userPattern.test(line) && line.includes('*') && i + 1 < lines.length) {
            const user = line;
            const content = lines[i + 1];
            if (content.length < 5 || content.match(/^(全部评价|问大家|查看更多)/)) continue;
            results.push({
              rank: results.length + 1,
              user,
              content: content.slice(0, 150),
              date: '',
            });
            i++;
            if (results.length >= ${limit}) break;
          }
        }
        return results;
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
