// Menu items revealed by chat-actions-menu + filter-chats deep audit:
//   Chat actions menu: side-chat, add-automation, open-in-new-window
//   Filter sidebar:    archive-all, organize-sidebar, sort-by
//
// These click on items inside menus that are NOT visible by default; the
// command opens the parent menu first, then clicks the target item.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

// Open a menu by clicking its trigger button, wait for radix portal, then
// click a menu item whose text matches `itemLabel` (exact or substring).
async function openMenuAndClick(page, triggerLabel, itemLabel) {
    const triggerClick = await page.evaluate(`(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const sels = ['button[aria-label="' + ${JSON.stringify(triggerLabel)} + '"]', 'button[aria-label^="' + ${JSON.stringify(triggerLabel)} + '"]'];
    let target = null;
    for (const s of sels) {
      target = Array.from(document.querySelectorAll(s)).filter(isVis)[0];
      if (target) break;
    }
    if (!target) return { ok: false, reason: 'Trigger button "' + ${JSON.stringify(triggerLabel)} + '" not visible.' };
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
    return { ok: true };
  })()`);
    if (!triggerClick?.ok) throw new CommandExecutionError(triggerClick?.reason || 'menu open failed', '');
    await page.wait(0.4);
    const itemClick = await page.evaluate(`(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(isVis);
    if (!menus.length) return { ok: false, reason: 'No menu visible after trigger click.' };
    const menu = menus[menus.length - 1];
    const items = Array.from(menu.querySelectorAll('[role="menuitem"], button'));
    const needle = ${JSON.stringify(itemLabel)}.toLowerCase();
    const target = items.find((it) => (it.innerText || '').trim().toLowerCase().includes(needle));
    if (!target) return { ok: false, reason: 'Menu item "' + ${JSON.stringify(itemLabel)} + '" not found. Items visible: ' + items.map((it) => (it.innerText || '').trim()).join(', ') };
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
    return { ok: true, clickedText: (target.innerText || '').trim() };
  })()`);
    if (!itemClick?.ok) throw new CommandExecutionError(itemClick?.reason || 'menu item click failed', '');
    return itemClick.clickedText;
}

// -------- side-chat --------
cli({
    site: 'codex',
    name: 'side-chat',
    access: 'write',
    description: 'Open the current conversation as a side chat (Chat actions menu → Open side chat).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const clicked = await openMenuAndClick(page, 'Chat actions', 'Open side chat');
        await page.wait(0.6);
        return [{ Status: `clicked: ${clicked}` }];
    },
});

// -------- add-automation --------
cli({
    site: 'codex',
    name: 'add-automation',
    access: 'write',
    description: 'Add an automation from the current conversation (Chat actions menu → Add automation…). Opens the create-automation dialog.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const clicked = await openMenuAndClick(page, 'Chat actions', 'Add automation');
        await page.wait(0.8);
        return [{ Status: `clicked: ${clicked}` }];
    },
});

// -------- open-in-new-window --------
cli({
    site: 'codex',
    name: 'open-in-new-window',
    access: 'write',
    description: 'Open the current conversation in a new Codex window (Chat actions menu → Open in new window).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const clicked = await openMenuAndClick(page, 'Chat actions', 'Open in new window');
        await page.wait(0.6);
        return [{ Status: `clicked: ${clicked}` }];
    },
});

// -------- archive-all --------
cli({
    site: 'codex',
    name: 'archive-all',
    access: 'write',
    description: 'DANGER: archive ALL chats from the Filter sidebar menu. Requires --yes; no undo from this command.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually archive all (default: dry-run)' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to ARCHIVE ALL CHATS (irreversible)' }];
        }
        const clicked = await openMenuAndClick(page, 'Filter sidebar chats', 'Archive all chats');
        await page.wait(1);
        return [{ Status: `clicked: ${clicked}` }];
    },
});

// -------- organize-sidebar --------
cli({
    site: 'codex',
    name: 'organize-sidebar',
    access: 'write',
    description: 'Open the Organize sidebar dialog (Filter sidebar menu → Organize sidebar).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const clicked = await openMenuAndClick(page, 'Filter sidebar chats', 'Organize sidebar');
        await page.wait(0.6);
        return [{ Status: `clicked: ${clicked}` }];
    },
});

// -------- sort-by --------
cli({
    site: 'codex',
    name: 'sort-by',
    access: 'read',
    description: 'Open the Sort by submenu and list its options.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        await openMenuAndClick(page, 'Filter sidebar chats', 'Sort by');
        await page.wait(0.4);
        const items = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(isVis);
      if (menus.length < 2) return [];
      // The submenu is the most-recently mounted menu.
      const submenu = menus[menus.length - 1];
      return Array.from(submenu.querySelectorAll('[role="menuitem"], button'))
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
    })()`);
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('codex sort-by', 'Sort-by submenu did not surface items.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});
