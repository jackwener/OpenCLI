// Global UI actions in the Codex Desktop app — sidebar / settings /
// account / nav-history / panels.
//
//   settings         — click the Settings button in the sidebar (opens
//                      the Settings panel; equivalent to Cmd+,)
//   search <query>   — open the sidebar Search (⌘G) and type the query;
//                      returns matched conversation titles
//   filter-chats     — click Filter sidebar chats and list filter options
//   sidebar-toggle   — Hide sidebar / Show sidebar (idempotent)
//   account          — read the account dropdown (email, plan, menu items)
//   nav <direction>  — Back or Forward in Codex's in-app nav history
//   toggle-panel <which>  — Toggle summary | bottom | side panel
//   add-files <file>      — set the composer's <input type=file> via CDP
//                           (pair with `send` to actually submit)
//   project-new <name> --yes — click Add new project + name + submit
//   start-chat-in <project> — click "Start new chat in <project>"
//   chat-actions-menu        — open the conversation header Chat actions
//                              menu and list visible items (not just the
//                              ones already wrapped: pin/unpin/archive/rename)

import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

function clickFirstVisibleScript(selectorList) {
    return `(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const sels = ${JSON.stringify(selectorList)};
    for (const sel of sels) {
      const target = Array.from(document.querySelectorAll(sel)).filter(isVis)[0];
      if (target) {
        const r = target.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.click();
        return { ok: true, sel };
      }
    }
    return { ok: false, reason: 'No matching visible element.' };
  })()`;
}

// -------- settings --------
cli({
    site: 'codex',
    name: 'settings',
    access: 'write',
    description: 'Click the sidebar Settings button (Cmd+,). Returns whether the Settings panel mounted.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'PanelVisible'],
    func: async (page) => {
        const res = await page.evaluate(clickFirstVisibleScript(['button[aria-label="Settings"]']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'settings click failed', '');
        await page.wait(0.8);
        // Detect if a settings dialog/panel mounted.
        const visible = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // Codex's Settings opens a dialog or a routed panel — look for
      // a labelled dialog or visible "Profile" / "Usage" / "Log out" text.
      const dlgs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVis);
      if (dlgs.length) return true;
      const txt = (document.body.innerText || '');
      return /Settings|Profile|Usage remaining|Log out/.test(txt);
    })()`);
        return [{ Status: 'clicked', PanelVisible: visible ? 'yes' : 'no' }];
    },
});

// -------- search --------
cli({
    site: 'codex',
    name: 'search',
    access: 'read',
    description: 'Open the sidebar Search (⌘G), type a query, and return matched conversations. Cleans up by pressing Escape on exit.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text' },
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: ['Index', 'Title'],
    func: async (page, kwargs) => {
        const query = String(kwargs?.query || '').trim();
        if (!query) throw new ArgumentError('query', 'is required');
        // Click search button — use *= to match any aria-label starting with "Search".
        const openRes = await page.evaluate(clickFirstVisibleScript([
            'button[aria-label^="Search"]',
            'button[aria-label="Search"]',
        ]));
        if (!openRes?.ok) throw new CommandExecutionError(openRes?.reason || 'search open failed', '');
        await page.wait(0.5);
        // Type into the topmost input.
        const fillRes = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')).filter(isVis);
      const input = inputs[inputs.length - 1];
      if (!input) return { ok: false, reason: 'No input visible after opening search.' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);
        if (!fillRes?.ok) throw new CommandExecutionError(fillRes?.reason || 'search type failed', '');
        await page.wait(0.8);
        // Read results — Codex usually renders matched conv titles as buttons/divs near the input.
        const items = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // Look for clickable rows in any visible search-result panel.
      const candidates = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], button[class*="result"], div[class*="result"]')).filter(isVis);
      const titles = candidates.map((c) => (c.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 200)).filter(Boolean);
      // Dedupe.
      return [...new Set(titles)];
    })()`);
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('codex search', `No results visible for "${query}". Codex's search panel may use a non-standard DOM.`);
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 20;
        return items.slice(0, limit).map((t, i) => ({ Index: i + 1, Title: t }));
    },
});

// -------- filter-chats --------
cli({
    site: 'codex',
    name: 'filter-chats',
    access: 'read',
    description: 'Click "Filter sidebar chats" and list the filter menu items.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        const res = await page.evaluate(clickFirstVisibleScript(['button[aria-label="Filter sidebar chats"]']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'filter-chats click failed', '');
        await page.wait(0.4);
        const items = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(isVis);
      if (!menus.length) return [];
      const menu = menus[menus.length - 1];
      return Array.from(menu.querySelectorAll('[role="menuitem"], button'))
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
    })()`);
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('codex filter-chats', 'Filter menu opened but no items detected.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});

// -------- sidebar-toggle --------
cli({
    site: 'codex',
    name: 'sidebar-toggle',
    access: 'write',
    description: 'Hide / show the Codex sidebar (idempotent — clicks whichever toggle button is currently visible).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await page.evaluate(clickFirstVisibleScript([
            'button[aria-label="Hide sidebar"]',
            'button[aria-label="Show sidebar"]',
        ]));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'sidebar-toggle failed', '');
        return [{ Status: `toggled via ${res.sel}` }];
    },
});

// -------- account --------
cli({
    site: 'codex',
    name: 'account',
    access: 'read',
    description: 'Read account info from the bottom-of-sidebar account dropdown (email, plan, profile/settings/log-out menu items).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Field', 'Value'],
    func: async (page) => {
        // The account dropdown is opened by clicking the account row at the
        // bottom of the sidebar. As of 2026-05-31 it's already-visible in
        // the DOM (no click required) — we just enumerate its contents.
        const data = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // Find any visible element containing an @-email; walk up to its
      // group container; collect all visible text nodes within.
      const all = Array.from(document.querySelectorAll('*')).filter(isVis);
      const emailEl = all.find((el) => {
        const txt = (el.innerText || '').trim();
        return txt.includes('@') && txt.length < 80 && el.children.length < 3;
      });
      if (!emailEl) return null;
      let container = emailEl;
      for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
      const items = Array.from(container.querySelectorAll('*')).filter((el) => isVis(el) && el.children.length === 0)
        .map((el) => (el.innerText || el.textContent || '').trim()).filter(Boolean);
      // Dedupe + take first 10.
      const seen = new Set();
      const uniq = items.filter((x) => { if (seen.has(x)) return false; seen.add(x); return true; }).slice(0, 12);
      return { email: emailEl.innerText.trim(), items: uniq };
    })()`);
        if (!data) {
            throw new CommandExecutionError('No account info visible — sidebar may be hidden or signed out.', '');
        }
        const rows = [{ Field: 'Email', Value: data.email }];
        data.items.forEach((it, i) => {
            if (it !== data.email) rows.push({ Field: `Item[${i + 1}]`, Value: it });
        });
        return rows;
    },
});

// -------- nav --------
cli({
    site: 'codex',
    name: 'nav',
    access: 'write',
    description: 'Navigate Codex in-app history (Back / Forward).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'direction', positional: true, required: true, help: 'back or forward' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const dir = String(kwargs?.direction || '').trim().toLowerCase();
        if (dir !== 'back' && dir !== 'forward') {
            throw new ArgumentError('direction', 'must be "back" or "forward"');
        }
        const label = dir === 'back' ? 'Back' : 'Forward';
        const res = await page.evaluate(clickFirstVisibleScript([`button[aria-label="${label}"]`]));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `${label} click failed`, '');
        return [{ Status: `nav ${dir} clicked` }];
    },
});

// -------- toggle-panel --------
cli({
    site: 'codex',
    name: 'toggle-panel',
    access: 'write',
    description: 'Toggle one of Codex\'s panels: summary, bottom, or side.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'which', positional: true, required: true, help: 'summary | bottom | side' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const which = String(kwargs?.which || '').trim().toLowerCase();
        const mapping = {
            summary: 'Toggle summary',
            bottom: 'Toggle bottom panel',
            side: 'Toggle side panel',
        };
        const label = mapping[which];
        if (!label) {
            throw new ArgumentError('which', 'must be summary | bottom | side');
        }
        const res = await page.evaluate(clickFirstVisibleScript([`button[aria-label="${label}"]`]));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `toggle-panel ${which} failed`, '');
        return [{ Status: `${label} clicked` }];
    },
});

// -------- add-files --------
cli({
    site: 'codex',
    name: 'add-files',
    access: 'write',
    description: 'Attach a local file to the Codex composer. Sets <input type=file> via CDP page.upload. Pair with `send` to actually submit.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'file', positional: true, required: true, help: 'Absolute path to the file to attach' },
    ],
    columns: ['Status', 'File'],
    func: async (page, kwargs) => {
        const file = String(kwargs?.file || '').trim();
        if (!file) throw new ArgumentError('file', 'is required');
        if (!fs.existsSync(file)) {
            throw new CommandExecutionError(`File not found: ${file}`, '');
        }
        // Find any visible file input.
        const sel = 'input[type="file"]';
        const exists = await page.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
        if (!exists) {
            // Codex hides the file input until "Add files and more" is opened.
            // Click "Add files and more" first to mount it.
            await page.evaluate(clickFirstVisibleScript(['button[aria-label="Add files and more"]']));
            await page.wait(0.5);
        }
        if (typeof page.upload !== 'function') {
            throw new CommandExecutionError('page.upload helper not available in this opencli build.', '');
        }
        await page.upload(sel, [file]);
        return [{ Status: 'attached', File: path.basename(file) }];
    },
});

// -------- chat-actions-menu --------
cli({
    site: 'codex',
    name: 'chat-actions-menu',
    access: 'read',
    description: 'Open the conversation header "Chat actions" menu and list every item visible (not just pin/unpin/archive/rename — useful for discovering unwrapped actions).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        const res = await page.evaluate(clickFirstVisibleScript(['button[aria-label="Chat actions"]']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Chat actions click failed', '');
        await page.wait(0.4);
        const items = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(isVis);
      if (!menus.length) return [];
      const menu = menus[menus.length - 1];
      return Array.from(menu.querySelectorAll('[role="menuitem"], button'))
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
    })()`);
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('codex chat-actions-menu', 'Chat actions menu opened but no items detected.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});

// -------- project-new --------
cli({
    site: 'codex',
    name: 'project-new',
    access: 'write',
    description: 'Click Add new project, type the name, submit. Requires --yes.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: true, help: 'Project name' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually create (default: dry-run)' },
    ],
    columns: ['Status', 'Name'],
    func: async (page, kwargs) => {
        const name = String(kwargs?.name || '').trim();
        if (!name) throw new ArgumentError('name', 'is required');
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run (pass --yes to create)', Name: name }];
        }
        const clickRes = await page.evaluate(clickFirstVisibleScript(['button[aria-label="Add new project"]']));
        if (!clickRes?.ok) throw new CommandExecutionError(clickRes?.reason || 'project-new click failed', '');
        await page.wait(0.8);
        const fillRes = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea')).filter(isVis);
      const input = inputs[inputs.length - 1];
      if (!input) return { ok: false, reason: 'No input after Add new project.' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // Try Enter to submit.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    })()`);
        if (!fillRes?.ok) throw new CommandExecutionError(fillRes?.reason || 'project-new dialog fill failed', '');
        return [{ Status: 'created', Name: name }];
    },
});

// -------- start-chat-in --------
cli({
    site: 'codex',
    name: 'start-chat-in',
    access: 'write',
    description: 'Click "Start new chat in <project>" in the sidebar for a named project.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', positional: true, required: true, help: 'Project name' },
    ],
    columns: ['Status', 'Project'],
    func: async (page, kwargs) => {
        const proj = String(kwargs?.project || '').trim();
        if (!proj) throw new ArgumentError('project', 'is required');
        const res = await page.evaluate(clickFirstVisibleScript([`button[aria-label="Start new chat in ${proj}"]`]));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `start-chat-in ${proj} failed`, '');
        await page.wait(0.6);
        return [{ Status: 'clicked', Project: proj }];
    },
});
