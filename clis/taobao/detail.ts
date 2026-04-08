import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from '../_shared/common.js';

cli({
  site: 'taobao',
  name: 'detail',
  description: '淘宝商品详情',
  domain: 'item.taobao.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', positional: true, required: true, help: '商品 ID' },
  ],
  columns: ['field', 'value'],
  navigateBefore: false,
  func: async (page, kwargs) => {
    const itemId = normalizeNumericId(kwargs.id, 'id', '827563850178');

    await page.goto('https://www.taobao.com');
    await page.wait(2);
    await page.evaluate(`location.href = ${JSON.stringify(`https://item.taobao.com/item.htm?id=${itemId}`)}`);
    await page.wait(6);

    const data = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const text = document.body?.innerText || '';
        const results = [];

        const titleEl = document.querySelector('[class*="mainTitle--"]');
        const title = titleEl ? normalize(titleEl.textContent) : document.title.split('-')[0].replace(/^【[^】]+】/, '').trim();
        results.push({ field: '商品名称', value: title.slice(0, 100) });

        const pricePattern = /[￥¥]\\s*(\\d+(?:\\.\\d{1,2})?)/g;
        const prices = [];
        let m;
        while ((m = pricePattern.exec(text)) && prices.length < 3) {
          const p = parseFloat(m[1]);
          if (p > 0.1 && p < 100000) prices.push(p);
        }
        if (prices.length > 0) {
          results.push({ field: '价格', value: '¥' + Math.min(...prices) });
        }

        const salesMatch = text.match(/(\\d+万?\\+?)\\s*人付款/) || text.match(/月销\\s*(\\d+万?\\+?)/);
        if (salesMatch) results.push({ field: '销量', value: salesMatch[0] });

        const reviewMatch = text.match(/累计评价\\s*(\\d+万?\\+?)/) || text.match(/评价[（(]\\s*(\\d+万?\\+?)/);
        if (reviewMatch) results.push({ field: '评价数', value: reviewMatch[1] });

        const ratingMatch = text.match(/(\\d+\\.\\d)\\s*(?:分|描述|物流|服务)/);
        if (ratingMatch) results.push({ field: '店铺评分', value: ratingMatch[0] });

        const shopMatch = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,15}(?:旗舰店|专卖店|企业店|专营店))/);
        if (shopMatch) results.push({ field: '店铺', value: shopMatch[1] });

        const locMatch = text.match(/发货地[：:]*\\s*([\u4e00-\u9fa5]{2,10})/) || text.match(/([\u4e00-\u9fa5]{2,4}(?:省|市))\\s*发货/);
        if (locMatch) results.push({ field: '发货地', value: locMatch[1] });

        if (text.includes('颜色分类')) {
          const start = text.indexOf('颜色分类');
          const specSection = start >= 0 ? text.substring(start, start + 200) : '';
          const specs = specSection.split('\\n').filter(l => l.trim().length > 2 && l.trim().length < 50).slice(0, 5);
          if (specs.length) results.push({ field: '可选规格', value: specs.join(' | ') });
        }

        results.push({ field: 'ID', value: ${JSON.stringify(itemId)} });
        results.push({ field: '链接', value: location.href.split('&')[0] });
        return results;
      })()
    `);
    return Array.isArray(data) ? data : [];
  },
});
