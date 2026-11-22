import { assertTaobaoPageUsable } from './page-state.js';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from '../_shared/common.js';
import {
    buildTaobaoPriceModel,
    buildTaobaoPriceModelFromState,
} from './price.js';

function documentTitleFromState(title) {
    return String(title || '').split('-')[0].replace(/^【[^】]+】/, '').trim();
}

cli({
    site: 'taobao',
    name: 'detail',
    access: 'read',
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
        await assertTaobaoPageUsable(page);

        const data = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const text = document.body?.innerText || '';
        const stateRes = window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res || null;
        const scope = document.querySelector('#right-content-area');
        const candidates = [];

        if (scope) {
          const seen = new Set();
          for (const el of scope.querySelectorAll('*')) {
            const own = Array.from(el.childNodes)
              .filter(node => node.nodeType === 3)
              .map(node => node.textContent || '')
              .join(' ');
            const nodeText = normalize(el.textContent);
            if (nodeText.length === 0 || nodeText.length > 220) continue;
            if (!/[￥¥]/.test(own) && !/[￥¥]/.test(nodeText)) continue;

            const context = normalize(el.parentElement?.innerText || nodeText).slice(0, 260);
            const key = nodeText + '|' + context;
            if (seen.has(key)) continue;
            seen.add(key);

            const idSelector = el.id ? '#' + el.id : '';
            const classes = typeof el.className === 'string'
              ? el.className.trim().split(/\\s+/).filter(Boolean)
              : [];
            const selector = el.tagName.toLowerCase() + idSelector +
              classes.map(name => '.' + name).join('');
            candidates.push({ text: nodeText, context, selector });
          }
        }

        return {
          state: stateRes ? {
            item: stateRes.item,
            componentsVO: { priceVO: stateRes.componentsVO?.priceVO || null },
            skuCore: { sku2info: stateRes.skuCore?.sku2info || null },
            skuBase: stateRes.skuBase || null,
          } : null,
          candidates,
          pageTitle: normalize(document.title),
          bodyText: text,
          scopeFound: Boolean(scope),
        };
      })()
    `);

        if (!data || typeof data !== 'object') {
            return [];
        }

        const stateItemId = String(data.state?.item?.itemId || '');
        const stateMatchesTarget = stateItemId === itemId;
        const statePricing = stateMatchesTarget
            ? buildTaobaoPriceModelFromState(data.state)
            : null;
        const domPricing = buildTaobaoPriceModel(data.candidates || []);
        const useStatePricing = statePricing?.pricing?.listing?.amount != null;
        const pricing = useStatePricing ? statePricing.pricing : domPricing;

        if (!stateMatchesTarget && pricing.listing.amount != null) {
            pricing.context.page_state_rejected = stateItemId || 'missing_item_id';
        }

        if (pricing.listing.amount == null) {
            pricing.listing.state = data.scopeFound ? 'not_present' : 'scope_missing';
        }

        if (useStatePricing) {
            if (pricing.original.amount == null && domPricing.original.amount != null) {
                pricing.original = domPricing.original;
            }
            if (pricing.activity.amount == null && domPricing.activity.amount != null) {
                pricing.activity = domPricing.activity;
            }
            if (pricing.coupon.amount == null && domPricing.coupon.amount != null) {
                pricing.coupon = domPricing.coupon;
            }
            for (const key of ['coupon_amount', 'subsidy_amount', 'coin_discount_amount', 'exchange_eligibility']) {
                if (domPricing.context[key] != null) pricing.context[key] = domPricing.context[key];
            }
        }

        const title = String((stateMatchesTarget ? data.state?.item?.title : '') || documentTitleFromState(data.pageTitle) || 'unavailable').trim();
        const bodyText = String(data.bodyText || '');
        const results = [{ field: '商品名称', value: title.slice(0, 100) }];
        const listing = pricing.listing;
        const estimated = pricing.estimated;
        const coupon = pricing.coupon;
        const original = pricing.original;
        const activity = pricing.activity;

        results.push({ field: '价格', value: listing?.display || 'unavailable' });
        results.push({ field: '价格数值', value: listing?.amount ?? null });
        results.push({ field: '商品标价', value: listing?.display || 'unavailable' });
        results.push({ field: '原价', value: original?.display || null });
        results.push({ field: '活动价', value: activity?.display || null });
        results.push({ field: '优惠券金额', value: pricing.context?.coupon_amount ?? null });
        results.push({ field: '券后价', value: coupon?.display || null });
        results.push({ field: '补贴金额', value: pricing.context?.subsidy_amount ?? null });
        results.push({ field: '预估应付', value: estimated?.amount ?? null });
        results.push({ field: '结算合计', value: pricing.checkout?.amount ?? null });
        results.push({ field: '价格来源', value: listing?.source_kind || 'none' });
        results.push({ field: '价格字段', value: listing?.source_path || null });
        results.push({ field: '价格状态', value: listing?.state || 'not_present' });
        results.push({
            field: 'SKU价格',
            value: statePricing?.skus?.length ? JSON.stringify(statePricing.skus) : null,
        });
        results.push({ field: '价格上下文', value: JSON.stringify(pricing.context || {}) });

        const salesMatch = bodyText.match(/(\d+万?\+?)\s*人付款/) || bodyText.match(/月销\s*(\d+万?\+?)/);
        if (salesMatch) results.push({ field: '销量', value: salesMatch[0] });

        const reviewMatch = bodyText.match(/累计评价\s*(\d+万?\+?)/) || bodyText.match(/评价[（(]\s*(\d+万?\+?)/);
        if (reviewMatch) results.push({ field: '评价数', value: reviewMatch[1] });

        const ratingMatch = bodyText.match(/(\d+\.\d)\s*(?:分|描述|物流|服务)/);
        if (ratingMatch) results.push({ field: '店铺评分', value: ratingMatch[0] });

        const shopMatch = bodyText.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,15}(?:旗舰店|专卖店|企业店|专营店))/);
        if (shopMatch) results.push({ field: '店铺', value: shopMatch[1] });

        const locMatch = bodyText.match(/发货地[：:]*\s*([\u4e00-\u9fa5]{2,10})/) || bodyText.match(/([\u4e00-\u9fa5]{2,4}(?:省|市))\s*发货/);
        if (locMatch) results.push({ field: '发货地', value: locMatch[1] });

        if (bodyText.includes('颜色分类')) {
            const start = bodyText.indexOf('颜色分类');
            const specs = bodyText.slice(start, start + 200).split('\n')
                .filter(line => line.trim().length > 2 && line.trim().length < 50)
                .slice(0, 5);
            if (specs.length) results.push({ field: '可选规格', value: specs.join(' | ') });
        }

        results.push({ field: 'ID', value: itemId });
        results.push({ field: '链接', value: `https://item.taobao.com/item.htm?id=${itemId}` });
        return results;
    },
});
