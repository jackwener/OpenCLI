// Read or switch the active Grok model.
//
//   model               — show the currently-active model (label only)
//   model --list        — open the model dropdown and list every option
//   model --set <name>  — open the dropdown and click the option matching <name>
//
// The model trigger is `#model-select-trigger` (utils.js already collects
// i18n fallback selectors). Dropdown items are rendered by radix-ui as
// `[role=menuitem]` once the trigger is clicked.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    IS_VISIBLE_JS,
    ensureOnGrok,
    getModelLabel,
} from './utils.js';

const MODEL_TRIGGER_SELECTORS = [
    '#model-select-trigger',
    'button[aria-label="Model select"]',
    'button[aria-label="模型选择"]',
    'button[aria-label="モデル選択"]',
];

async function openModelMenu(page) {
    const selJson = JSON.stringify(MODEL_TRIGGER_SELECTORS);
    const res = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const sels = ${selJson};
    for (const s of sels) {
      const el = Array.from(document.querySelectorAll(s)).find((n) => isVisible(n));
      if (el) {
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.click();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'Model trigger button not visible.' };
  })()`);
    if (!res?.ok) {
        throw new CommandExecutionError(res?.reason || 'Failed to open model menu', '');
    }
    // Wait briefly for radix portal to mount + animate.
    await page.wait(0.4);
}

async function readMenuItems(page) {
    return await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    // radix renders the dropdown in a portal at body level — find the
    // most-recently mounted [role=menu] that's visible.
    const menus = Array.from(document.querySelectorAll('[role=menu]')).filter((n) => isVisible(n));
    if (!menus.length) return [];
    const menu = menus[menus.length - 1];
    const items = Array.from(menu.querySelectorAll('[role=menuitem], [role=option]'));
    return items.map((it) => {
      // Grok renders the model name as the primary text node + a secondary
      // span with description. We take innerText as the simplest stable
      // signal and strip duplicate whitespace.
      const text = (it.innerText || '').trim().replace(/\\s+/g, ' ');
      const ariaChecked = it.getAttribute('aria-checked');
      const dataState = it.getAttribute('data-state');
      const active = ariaChecked === 'true' || dataState === 'checked';
      return { text, active };
    }).filter((x) => x.text);
  })()`);
}

async function closeMenuByEscape(page) {
    try {
        await page.keys('Escape');
    } catch {
        // ignore — best-effort close
    }
}

// ---------------- model ----------------
cli({
    site: 'grok',
    name: 'model',
    access: 'read',
    description: 'Read the current Grok model, list available models (--list), or switch model (--set <name>). Switching opens the model dropdown and clicks the matching item.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'list', type: 'boolean', default: false, help: 'List all model options (opens dropdown)' },
        { name: 'set', required: false, help: 'Switch to the model whose name matches (substring, case-insensitive)' },
    ],
    columns: ['Index', 'Model', 'Active'],
    func: async (page, kwargs) => {
        await ensureOnGrok(page);
        const wantList = kwargs?.list === true || kwargs?.list === 'true';
        const wantSet = String(kwargs?.set || '').trim();

        if (!wantList && !wantSet) {
            const cur = await getModelLabel(page);
            return [{ Index: 1, Model: cur || '(unknown)', Active: 'yes' }];
        }

        await openModelMenu(page);
        const items = await readMenuItems(page);
        if (!items.length) {
            await closeMenuByEscape(page);
            throw new CommandExecutionError('Model dropdown opened but no items found.', '');
        }

        if (wantSet) {
            const needle = wantSet.toLowerCase();
            const matchIdx = items.findIndex((it) => it.text.toLowerCase().includes(needle));
            if (matchIdx < 0) {
                await closeMenuByEscape(page);
                throw new ArgumentError('set', `No model matched "${wantSet}". Available: ${items.map((i) => i.text).join(', ')}`);
            }
            // Re-find by index inside the menu and click it.
            const clickRes = await page.evaluate(`(() => {
        const menus = Array.from(document.querySelectorAll('[role=menu]'));
        if (!menus.length) return { ok: false, reason: 'menu vanished' };
        const menu = menus[menus.length - 1];
        const items = Array.from(menu.querySelectorAll('[role=menuitem], [role=option]'));
        const target = items[${matchIdx}];
        if (!target) return { ok: false, reason: 'index out of range' };
        const r = target.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.click();
        return { ok: true, clicked: target.innerText.trim() };
      })()`);
            if (!clickRes?.ok) {
                throw new CommandExecutionError(clickRes?.reason || 'Click on model item failed', '');
            }
            await page.wait(0.5);
            return [{ Index: 1, Model: clickRes.clicked, Active: 'switched' }];
        }

        // --list path
        await closeMenuByEscape(page);
        return items.map((it, i) => ({
            Index: i + 1,
            Model: it.text,
            Active: it.active ? 'yes' : '',
        }));
    },
});
