import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from '../_shared/common.js';
cli({
    site: 'jd',
    name: 'detail',
    description: '京东商品详情',
    domain: 'item.jd.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'sku', positional: true, required: true, help: '商品 SKU ID' },
    ],
    columns: ['field', 'value'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const sku = normalizeNumericId(kwargs.sku, 'sku', '100291143898');
        await page.goto(`https://item.jd.com/${sku}.html`);
        await page.wait(5);
        const data = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const text = document.body?.innerText || '';

        const titleMatch = document.title.match(/^【[^】]*】(.+?)【/);
        const title = titleMatch ? titleMatch[1].trim() : normalize(document.title.split('【')[0]);

        const priceMatch = text.match(/¥([\\d,.]+)/);
        const price = priceMatch ? '¥' + priceMatch[1] : '';

        const ratingMatch = text.match(/(超\\d+%[^\\n]{2,20})/);
        const rating = ratingMatch ? ratingMatch[1] : '';

        const reviewMatch = text.match(/买家评价\\(([\\d万+]+)\\)/);
        const reviews = reviewMatch ? reviewMatch[1] : '';

        const shopMatch = text.match(/(\\S{2,15}(?:京东自营旗舰店|旗舰店|专卖店|自营店))/);
        const shop = shopMatch ? shopMatch[1] : '';

        const tagPattern = /([\u4e00-\u9fa5]{2,8})\\s+(\\d+)/g;
        const tags = [];
        let m;
        const tagStart = text.indexOf('买家评价');
        const tagSection = tagStart >= 0 ? text.substring(tagStart, tagStart + 500) : '';
        while ((m = tagPattern.exec(tagSection)) && tags.length < 6) {
          if (parseInt(m[2], 10) > 1) tags.push(m[1] + '(' + m[2] + ')');
        }

        const results = [
          { field: '商品名称', value: title },
          { field: '价格', value: price },
          { field: 'SKU', value: ${JSON.stringify(sku)} },
          { field: '店铺', value: shop },
          { field: '评价数量', value: reviews },
          { field: '好评率', value: rating },
          { field: '评价标签', value: tags.join(' | ') },
          { field: '链接', value: location.href },
        ];
        return results.filter(r => r.value);
      })()
    `);
        return Array.isArray(data) ? data : [];
    },
});
