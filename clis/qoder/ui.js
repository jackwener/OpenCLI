// Global UI commands for Qoder.
//
//   sidebar-toggle  — Collapse Quest List (⌘B)
//   open-panel      — Open Panel (⌥⌘B) — bottom panel
//   search          — Search (⌘P) palette
//   settings        — Settings
//   knowledge       — open Knowledge view
//   marketplace     — open Marketplace
//   credits         — Credits Usage
//   view-all        — View all quests
//   add-workspace   — Add Workspace
//   account         — read user info (the "leo"-style button at bottom)
//   more-actions    — open More Actions menu + list items

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { IS_VISIBLE_JS, clickByTextScript, clickFirstScript, evaluateQoder, parsePositiveInt, requireArrayResult } from './_utils.js';

// -------- sidebar-toggle --------
cli({
    site: 'qoder',
    name: 'sidebar-toggle',
    access: 'write',
    description: 'Collapse / Expand the Qoder Quest List sidebar (⌘B).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Collapse Quest List', 'Expand Quest List']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'sidebar-toggle failed', '');
        return [{ Status: `clicked: ${res.matched}` }];
    },
});

// -------- open-panel --------
cli({
    site: 'qoder',
    name: 'open-panel',
    access: 'write',
    description: 'Open / close the Qoder bottom panel (Output / Terminal / Debug Console). ⌥⌘B equivalent.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Open Panel', 'Close Panel']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'open-panel failed', '');
        return [{ Status: `clicked: ${res.matched}` }];
    },
});

// -------- search --------
cli({
    site: 'qoder',
    name: 'search',
    access: 'read',
    description: 'Open Qoder Search palette (⌘P), type a query, return matched options.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text' },
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: ['Index', 'Item'],
    func: async (page, kwargs) => {
        const query = String(kwargs?.query || '').trim();
        if (!query) throw new ArgumentError('query', 'is required');
        const limit = parsePositiveInt(kwargs?.limit, 20, '--limit');
        const openRes = await evaluateQoder(page, clickByTextScript(['Search']));
        if (!openRes?.ok) throw new CommandExecutionError(openRes?.reason || 'search open failed', '');
        await page.wait(0.5);
        // Type into the visible input (usually the most-recently mounted one).
        const fillRes = await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')).filter(isVisible);
      const input = inputs[inputs.length - 1];
      if (!input) return { ok: false, reason: 'No input visible.' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);
        if (!fillRes?.ok) throw new CommandExecutionError(fillRes?.reason || 'search type failed', '');
        await page.wait(0.8);
        const items = requireArrayResult(await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      // Search palette results: prefer [role=option], else any clickable row in the modal.
      const opts = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]')).filter(isVisible);
      const titles = opts.map((o) => {
        // Codex-style fix: text may be in per-char spans; use textContent.
        const titleEl = o.querySelector('.truncate, [class*="title"i]') || o;
        return (titleEl.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
      }).filter(Boolean);
      return [...new Set(titles)];
    })()`), 'qoder search');
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('qoder search', `No items matched "${query}".`);
        }
        return items.slice(0, limit).map((t, i) => ({ Index: i + 1, Item: t }));
    },
});

// -------- settings --------
cli({
    site: 'qoder',
    name: 'settings',
    access: 'write',
    description: 'Click the Settings button in the Qoder sidebar.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Settings']));
        if (!res?.ok) {
            // Fallback: try aria-label.
            const ariaRes = await evaluateQoder(page, clickFirstScript(['button[aria-label="Settings"]']));
            if (!ariaRes?.ok) throw new CommandExecutionError('Settings button not found', '');
        }
        await page.wait(0.5);
        return [{ Status: 'clicked' }];
    },
});

// -------- knowledge --------
cli({
    site: 'qoder',
    name: 'knowledge',
    access: 'write',
    description: 'Open the Knowledge view (Qoder\'s personal/team knowledge base).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Knowledge']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Knowledge button not found', '');
        return [{ Status: 'clicked' }];
    },
});

// -------- marketplace --------
cli({
    site: 'qoder',
    name: 'marketplace',
    access: 'write',
    description: 'Open the Qoder Marketplace.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Marketplace']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Marketplace button not found', '');
        return [{ Status: 'clicked' }];
    },
});

// -------- credits --------
cli({
    site: 'qoder',
    name: 'credits',
    access: 'read',
    description: 'Click "Credits Usage" and return the credits-usage display text.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Field', 'Value'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Credits Usage']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Credits Usage not visible', '');
        await page.wait(0.5);
        // Try to read whatever appears.
        const info = await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      // Find any dialog/popover that appeared.
      const popovers = Array.from(document.querySelectorAll('[role="dialog"], [class*="popover"i], [class*="popup"i]')).filter(isVisible);
      if (!popovers.length) return null;
      const pop = popovers[popovers.length - 1];
      return (pop.innerText || pop.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 600);
    })()`);
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        return [
            { Field: 'Status', Value: 'clicked' },
            { Field: 'Info', Value: info || '(no popover detected after click)' },
        ];
    },
});

// -------- view-all --------
cli({
    site: 'qoder',
    name: 'view-all',
    access: 'write',
    description: 'Click "View all" to show all Quests.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['View all']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'View all button not visible', '');
        return [{ Status: 'clicked' }];
    },
});

// -------- add-workspace --------
cli({
    site: 'qoder',
    name: 'add-workspace',
    access: 'write',
    description: 'Click "Add Workspace" — opens the folder picker. Note: this opens a system file-picker dialog that Qoder controls; the actual folder selection must be done in the UI by the user.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Add Workspace']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Add Workspace button not found', '');
        return [{ Status: 'clicked — folder picker opened (manual selection required)' }];
    },
});

// -------- account --------
cli({
    site: 'qoder',
    name: 'account',
    access: 'read',
    description: 'Click the account button (username) in the Qoder sidebar and return the visible account dropdown items.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', required: false, help: 'Username text shown in the sidebar (default: tries common short labels)' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        // The account button label is the user's display name. We try a few
        // common patterns: if --username is passed we use it, else we look
        // for any short button text that doesn't match other known controls.
        let label = String(kwargs?.username || '').trim();
        if (!label) {
            // Heuristic discovery.
            label = await evaluateQoder(page, `(() => {
        ${IS_VISIBLE_JS}
        const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
        const known = new Set(['Pin', 'Copy', 'New Quest', 'Search', 'Settings', 'View all', 'Knowledge', 'Marketplace', 'Credits Usage', 'Open Editor', 'Add Workspace', 'More Actions', 'Send message', 'Prompt Enhance', 'Voice input', 'button']);
        const candidate = btns.find((b) => {
          const tx = (b.innerText || '').trim();
          if (!tx || tx.length > 30 || tx.includes('⌘') || known.has(tx)) return false;
          if (/^(New|Open|Add|Save|Edit|Cancel|OK|Close)/.test(tx)) return false;
          return true;
        });
        return candidate ? (candidate.innerText || '').trim() : '';
      })()`);
        }
        if (!label) {
            throw new CommandExecutionError('No account button detected. Pass --username <name> explicitly.', '');
        }
        // Click the username button
        const clickRes = await evaluateQoder(page, clickByTextScript([label], { exact: true, maxLen: 60 }));
        if (!clickRes?.ok) throw new CommandExecutionError(`Click on account button "${label}" failed`, '');
        await page.wait(0.5);
        const items = requireArrayResult(await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      const popovers = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [class*="popover"i], [class*="dropdown"i]')).filter(isVisible)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 500 && r.height < 600; });
      if (!popovers.length) return [];
      const pop = popovers[popovers.length - 1];
      return Array.from(pop.querySelectorAll('button, [role="menuitem"], a'))
        .filter(isVisible)
        .map((b) => (b.innerText || b.textContent || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
    })()`), 'qoder account');
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        const rows = [{ Field: 'Username', Value: label }];
        (items || []).slice(0, 20).forEach((item, i) => {
            rows.push({ Field: `Item[${i + 1}]`, Value: item });
        });
        return rows;
    },
});

// -------- more-actions --------
cli({
    site: 'qoder',
    name: 'more-actions',
    access: 'read',
    description: 'Click the "More Actions" button and list its menu items.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['More Actions']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'More Actions button not found', '');
        await page.wait(0.4);
        const items = requireArrayResult(await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      const popovers = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [class*="popover"i], [class*="menu"i]')).filter(isVisible)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 500 && r.height < 600; });
      if (!popovers.length) return [];
      const pop = popovers[popovers.length - 1];
      return Array.from(pop.querySelectorAll('[role="menuitem"], button'))
        .filter(isVisible)
        .map((b) => (b.innerText || b.textContent || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
    })()`), 'qoder more-actions');
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('qoder more-actions', 'Menu opened but no items detected.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});
