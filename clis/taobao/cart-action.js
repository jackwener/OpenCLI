import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { taobaoPageState, requireTaobaoPageState } from './page-state.js';

function visible(node) {
    if (!(node instanceof Element) || node.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function successNodes() {
    return Array.from(document.querySelectorAll('div, span, p, [role="alert"], [role="status"]'))
        .filter(node => visible(node) && /^(?:成功加入购物车|已加入购物车|商品已成功加入购物车)[！!。\s]*$/.test((node.textContent || '').trim()));
}

export async function addTaobaoCartOnce(page) {
    if (typeof page.evaluateOnce !== 'function') throw new CommandExecutionError('Adding to cart requires evaluateOnce support.');
    const result = await page.evaluateOnce(`(() => {
        const state = (${taobaoPageState.toString()})();
        if (state !== 'ok') return { state };
        const visible = ${visible.toString()};
        const successNodes = ${successNodes.toString()};
        const candidates = new Set();
        const enabled = node => visible(node) && !node.closest('[disabled], [aria-disabled="true"]') && !/(?:disabled|gray)/i.test(node.className || '');
        for (const node of document.querySelectorAll('button, [role="button"], a, div, span')) {
            if (!/^加入\\s*购物车$/.test((node.textContent || '').trim()) || !enabled(node)) continue;
            const button = node.closest('button, [role="button"], [class*="btnItem--"]') || node;
            if (enabled(button)) candidates.add(button);
        }
        for (const icon of document.querySelectorAll('[class*="btnItem--"] i[class*="jiarugouwuche"]')) {
            const button = icon.closest('[class*="btnItem--"]');
            if (enabled(button)) candidates.add(button);
        }
        // Collapse text wrappers around the same control, never separate buttons.
        const buttons = Array.from(candidates).filter(node => !Array.from(candidates).some(other => other !== node && node.contains(other)));
        if (buttons.length !== 1) return { state, result: buttons.length ? 'ambiguous' : 'missing' };
        window.__opencliCartSuccessBefore = new WeakSet(successNodes());
        buttons[0].click();
        return { state, result: 'clicked' };
    })()`);
    requireTaobaoPageState(result?.state);
    if (result.result !== 'clicked') throw new CommandExecutionError(`Taobao add-to-cart button is ${result.result === 'ambiguous' ? 'ambiguous' : 'missing or disabled'}. No add-to-cart click was sent.`);
    try {
        for (let i = 0; i < 10; i++) {
            await page.wait(0.5);
            const status = await page.evaluate(`(() => {
                const state = (${taobaoPageState.toString()})();
                if (state !== 'ok') return { state };
                const visible = ${visible.toString()};
                const successNodes = ${successNodes.toString()};
                const before = window.__opencliCartSuccessBefore;
                if (!before) return { state, result: 'unknown' };
                if (successNodes().some(node => !before.has(node))) return { state, result: 'success' };
                const needsSpec = Array.from(document.querySelectorAll('[role="alert"], [role="dialog"], [class*="toast"], [class*="Toast"]')).some(node => visible(node) && /请选择|请先选择/.test(node.textContent || ''));
                return { state, result: needsSpec ? 'need_spec' : 'unknown' };
            })()`);
            requireTaobaoPageState(status?.state);
            if (status.result === 'success') return;
            if (status.result === 'need_spec') throw new ArgumentError('Taobao requires additional product specifications.');
        }
        throw new CommandExecutionError('Taobao add-to-cart outcome could not be confirmed.', 'Check your cart before retrying to avoid adding the item twice.');
    } finally {
        await page.evaluate('delete window.__opencliCartSuccessBefore').catch(() => {});
    }
}
