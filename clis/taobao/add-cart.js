import { assertTaobaoPageUsable } from './page-state.js';
import { addTaobaoCartOnce } from './cart-action.js';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from '../_shared/common.js';
cli({
    site: 'taobao',
    name: 'add-cart',
    access: 'write',
    description: '淘宝加入购物车',
    domain: 'item.taobao.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: '商品 ID' },
        { name: 'spec', help: '规格关键词（如 "180度" "红色 XL"），多个规格用空格分隔，模糊匹配' },
        { name: 'dry-run', type: 'bool', default: false, help: '仅预览，不实际加入购物车' },
    ],
    columns: ['status', 'title', 'price', 'selected_spec', 'item_id'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const itemId = normalizeNumericId(kwargs.id, 'id', '827563850178');
        const specKeywords = kwargs.spec ? String(kwargs.spec).split(/\s+/).filter(Boolean) : [];
        const dryRun = !!kwargs['dry-run'];
        await page.goto('https://www.taobao.com');
        await page.wait(2);
        await page.evaluate(`location.href = ${JSON.stringify(`https://item.taobao.com/item.htm?id=${itemId}`)}`);
        await page.wait(6);
        await assertTaobaoPageUsable(page);
        const info = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const titleEl = document.querySelector('[class*="mainTitle--"]');
        const title = titleEl ? normalize(titleEl.textContent) : document.title.split('-')[0].trim();
        const text = document.body?.innerText || '';
        const priceMatch = text.match(/[￥¥]\\s*(\\d+(?:\\.\\d{1,2})?)/);
        const price = priceMatch ? '¥' + priceMatch[1] : '';
        return { title: title.slice(0, 80), price };
      })()
    `);
        if (dryRun) {
            return [{
                    status: 'dry-run',
                    title: info?.title || '',
                    price: info?.price || '',
                    selected_spec: specKeywords.join(' ') || '(未选择)',
                    item_id: itemId,
                }];
        }
        const specArgs = JSON.stringify(specKeywords);
        const selectResult = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const keywords = ${specArgs};
        const items = document.querySelectorAll('[class*="valueItem--"]');
        const selected = [];

        if (keywords.length === 0 && items.length > 0) {
          const groups = new Map();
          for (const item of items) {
            const group = item.closest('[class*="skuItem--"], [class*="prop--"]') || item.parentElement;
            const groupKey = group?.className?.substring(0, 30) || 'default';
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(item);
          }
          for (const [, groupItems] of groups) {
            const hasSelected = groupItems.some(el => el.className.includes('selected') || el.className.includes('active'));
            if (hasSelected) continue;
            for (const item of groupItems) {
              if (!item.className.includes('disabled') && !item.className.includes('gray')) {
                item.click();
                selected.push(normalize(item.textContent).substring(0, 40));
                break;
              }
            }
          }
        } else {
          const groups = new Map();
          for (const item of items) {
            const group = item.closest('[class*="skuItem--"], [class*="prop--"]') || item.parentElement;
            const groupKey = group?.className?.substring(0, 30) || 'default';
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(item);
          }

          for (const [, groupItems] of groups) {
            let best = null;
            let bestScore = 0;
            for (const item of groupItems) {
              if (item.className.includes('disabled')) continue;
              const t = normalize(item.textContent);
              const score = keywords.filter(kw => t.includes(kw)).length;
              if (score > bestScore) { bestScore = score; best = item; }
            }
            if (best && bestScore > 0) {
              best.click();
              selected.push(normalize(best.textContent).substring(0, 40));
            }
          }
        }
        return selected;
      })()
    `);
        await page.wait(1);
        await addTaobaoCartOnce(page);
        const status = '✓ 已加入购物车';
        const selectedSpec = Array.isArray(selectResult) ? selectResult.join(' | ') : '';
        return [{
                status,
                title: info?.title || '',
                price: info?.price || '',
                selected_spec: selectedSpec || '(未选择)',
                item_id: itemId,
            }];
    },
});
