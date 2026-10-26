import { assertTaobaoPageUsable } from './page-state.js';
import { addTaobaoCartOnce } from './cart-action.js';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from '../_shared/common.js';
// Taobao renders one SKU dimension per container and re-renders the whole
// panel after every option click, which wipes previously selected dimensions.
// Walk one dimension at a time, re-querying the DOM between clicks, and read
// the final selection state from the page instead of trusting what we clicked
// (#2428).
const SKU_RERENDER_WAIT_S = 0.9;
const SKU_MAX_DIMENSION_STEPS = 10;

function clickNextSkuOptionInPage(input) {
    const keywords = Array.isArray(input && input.keywords) ? input.keywords : [];
    const normalize = v => (v || '').replace(/\s+/g, ' ').trim();
    const classText = el => (el && typeof el.className === 'string' ? el.className : '');
    const hasToken = (el, tokens) => tokens.some(token => new RegExp('(^|[\\s_-])' + token + '([\\s_-]|$)', 'i').test(classText(el)));
    const isSelected = el => hasToken(el, ['selected', 'active', 'checked']) || (el && el.getAttribute && el.getAttribute('aria-checked') === 'true');
    const isDisabled = el => hasToken(el, ['disabled', 'gray']) || (el && el.getAttribute && el.getAttribute('aria-disabled') === 'true');
    // Prefer the per-dimension container: the shared `skuItem--` wrapper spans
    // every dimension, so grouping by it collapses all options into one group.
    const groupOf = el => el.closest('[class*="skuItemClipX--"]') || el.closest('[class*="skuItem--"]') || el.closest('[class*="prop--"]') || el.parentElement;

    const items = Array.from(document.querySelectorAll('[class*="valueItem--"]'));
    const groups = new Map();
    for (const item of items) {
        const group = groupOf(item);
        if (!group) continue;
        const existing = groups.get(group);
        if (existing) existing.push(item);
        else groups.set(group, [item]);
    }
    if (groups.size === 0) return { phase: 'no_groups', clickedText: '', selected: [] };

    const selected = [];
    for (const groupItems of groups.values()) {
        const chosen = groupItems.find(isSelected);
        if (chosen) selected.push(normalize(chosen.textContent).substring(0, 40));
    }
    const pending = Array.from(groups.values()).filter(groupItems => !groupItems.some(isSelected));
    if (pending.length === 0) return { phase: 'all_selected', clickedText: '', selected };

    const enabled = pending[0].filter(item => !isDisabled(item));
    if (enabled.length === 0) return { phase: 'no_options', clickedText: '', selected };

    let choice = null;
    let bestScore = 0;
    for (const item of enabled) {
        const text = normalize(item.textContent);
        let score = 0;
        for (const keyword of keywords) {
            if (keyword && text.includes(keyword)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            choice = item;
        }
    }
    if (!choice) choice = enabled[0];
    choice.click();
    return { phase: 'clicked', clickedText: normalize(choice.textContent).substring(0, 40), selected };
}

export function buildClickNextSkuOptionScript(keywords) {
    return `(${clickNextSkuOptionInPage.toString()})(${JSON.stringify({ keywords })})`;
}

/**
 * Select SKU dimensions sequentially, waiting for the panel re-render between
 * clicks. Returns the final selected labels (or the last observed state when
 * walkthrough stalls), so callers can report the real selection instead of the
 * clicks that were attempted.
 */
export async function selectTaobaoSkuOptions(page, specKeywords) {
    const keywords = Array.isArray(specKeywords) ? specKeywords : [];
    const selected = [];
    for (let step = 0; step < SKU_MAX_DIMENSION_STEPS; step += 1) {
        const result = await page.evaluate(buildClickNextSkuOptionScript(keywords));
        if (!result || typeof result !== 'object') return { selected, state: 'malformed' };
        if (result.phase === 'all_selected') {
            const finalSelected = Array.isArray(result.selected) ? result.selected.filter(Boolean) : [];
            return { selected: finalSelected.length ? finalSelected : selected, state: 'complete' };
        }
        if (result.phase !== 'clicked') return { selected, state: result.phase || 'stalled' };
        if (result.clickedText) selected.push(result.clickedText);
        await page.wait(SKU_RERENDER_WAIT_S);
    }
    return { selected, state: 'max_steps' };
}

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
        const selection = await selectTaobaoSkuOptions(page, specKeywords);
        await page.wait(1);
        await addTaobaoCartOnce(page);
        const status = '✓ 已加入购物车';
        const selectedSpec = selection.selected.join(' | ');
        return [{
                status,
                title: info?.title || '',
                price: info?.price || '',
                selected_spec: selectedSpec || '(未选择)',
                item_id: itemId,
            }];
    },
});
