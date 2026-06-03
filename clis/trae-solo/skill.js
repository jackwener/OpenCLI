// Read-only commands for the TRAE SOLO Skills Marketplace panel:
//   skill-list / skill-search / skill-category
//
// All commands switch to the Skills panel first (sidebar entry
// '.task-list-new-task-item.task-list-skills-item' with text 'Skills').
//
// Skills UI structure:
//   .marketplace-tab               'Skills Marketplace' / 'Installed <N>'
//   .marketplace-tag               6 categories: All / Developer Tools /
//                                  Data Analysis / UI Design / Content Creation / Productivity
//   input[placeholder="Search"]    text filter input
//   .marketplace-card-v2 × ~51     marketplace card view (browse all)
//   .installed-card × ~49          installed view
// Write-side marketplace operations are intentionally not exposed here until
// they can prove install/uninstall/run/toggle postconditions instead of only
// proving a button click.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { switchToPanel } from './_actions.js';

const SESSION_HINT = 'Make sure TRAE SOLO is running and the Skills panel is reachable.';

async function ensureSkillsTab(page, tabName) {
    const nameJson = JSON.stringify(tabName);
    await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = ${nameJson};
    const tab = Array.from(document.querySelectorAll('.marketplace-tab'))
      .find((t) => (t.textContent || '').trim().startsWith(target));
    if (!tab) return;
    if (tab.className.includes('active')) return;
    const r = tab.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    tab.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    tab.dispatchEvent(new MouseEvent('mousedown', init));
    tab.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    tab.dispatchEvent(new MouseEvent('mouseup', init));
    tab.dispatchEvent(new MouseEvent('click', init));
    await wait(700);
  })()`);
    await page.wait(0.3);
}

// -------- skill-list --------
cli({
    site: 'trae-solo',
    name: 'skill-list',
    access: 'read',
    description: 'List Trae SOLO Skills — by default the Marketplace; pass --installed to list installed ones.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'installed', type: 'boolean', default: false, help: 'List installed skills instead of the marketplace' },
        { name: 'limit', type: 'int', required: false, default: 100, help: 'Max rows to return' },
    ],
    columns: ['Index', 'Name', 'Description'],
    func: async (page, kwargs) => {
        await switchToPanel(page, 'Skills');
        const installed = kwargs.installed === true || kwargs.installed === 'true' || kwargs.installed === '1';
        await ensureSkillsTab(page, installed ? 'Installed' : 'Skills Marketplace');

        const items = await page.evaluate(`(function() {
      const sel = ${installed ? "'.installed-card'" : "'.marketplace-card-v2'"};
      const cards = Array.from(document.querySelectorAll(sel)).filter((c) => c.offsetParent);
      return cards.map((c, i) => {
        const logo = c.querySelector('.skill-logo-svg');
        const name = (logo && logo.getAttribute('aria-label')) || '';
        // Card text starts with the name; trim that off to get description.
        const full = (c.innerText || '').replace(/\\s+/g, ' ').trim();
        let desc = full;
        if (name && desc.startsWith(name)) desc = desc.slice(name.length).trim();
        return { index: i + 1, name: name || full.split(' ')[0], description: desc.slice(0, 200) };
      });
    })()`);
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        const rows = (items || []).slice(0, limit);
        if (!rows.length) {
            throw new EmptyResultError(
                'trae-solo skill-list',
                installed ? 'No installed skills visible.' : 'No marketplace skills visible.',
            );
        }
        return rows.map((r) => ({ Index: r.index, Name: r.name, Description: r.description }));
    },
});

// -------- skill-search --------
cli({
    site: 'trae-solo',
    name: 'skill-search',
    access: 'read',
    description: 'Filter Skills Marketplace by keyword.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search keyword (substring)' },
        { name: 'limit', type: 'int', required: false, default: 50, help: 'Max rows' },
    ],
    columns: ['Index', 'Name', 'Description'],
    func: async (page, kwargs) => {
        await switchToPanel(page, 'Skills');
        await ensureSkillsTab(page, 'Skills Marketplace');
        const keyword = String(kwargs.keyword || '').trim();
        if (!keyword) throw new ArgumentError('keyword cannot be empty');

        const kwJson = JSON.stringify(keyword);
        await page.evaluate(`(function() {
      const inp = document.querySelector('input[placeholder="Search"]');
      if (!inp) return;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${kwJson});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
        await page.wait(0.7);

        const items = await page.evaluate(`(function() {
      const cards = Array.from(document.querySelectorAll('.marketplace-card-v2')).filter((c) => c.offsetParent);
      return cards.map((c, i) => {
        const logo = c.querySelector('.skill-logo-svg');
        const name = (logo && logo.getAttribute('aria-label')) || '';
        const full = (c.innerText || '').replace(/\\s+/g, ' ').trim();
        let desc = full;
        if (name && desc.startsWith(name)) desc = desc.slice(name.length).trim();
        return { index: i + 1, name: name || full.split(' ')[0], description: desc.slice(0, 200) };
      });
    })()`);
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 50;
        const rows = (items || []).slice(0, limit);
        if (!rows.length) {
            throw new EmptyResultError('trae-solo skill-search', `No skills matched "${keyword}".`);
        }
        return rows.map((r) => ({ Index: r.index, Name: r.name, Description: r.description }));
    },
});

// -------- skill-category --------
cli({
    site: 'trae-solo',
    name: 'skill-category',
    access: 'read',
    description: 'Filter Skills Marketplace by category. Pass --list to see categories.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: false, help: 'Category name (substring; case-insensitive). Common: All / Developer Tools / Data Analysis / UI Design / Content Creation / Productivity' },
        { name: 'list', type: 'boolean', default: false, help: 'List available categories' },
        { name: 'limit', type: 'int', required: false, default: 100 },
    ],
    columns: ['Index', 'Name', 'Description'],
    func: async (page, kwargs) => {
        await switchToPanel(page, 'Skills');
        await ensureSkillsTab(page, 'Skills Marketplace');
        const listOnly = kwargs.list === true || kwargs.list === 'true';
        const name = String(kwargs.name || '').trim().toLowerCase();

        const cats = await page.evaluate(`(function() {
      return Array.from(document.querySelectorAll('.marketplace-tag'))
        .filter((c) => c.offsetParent)
        .map((c) => ({ text: (c.textContent || '').trim(), active: c.className.includes('active') }));
    })()`);

        if (listOnly) {
            return (cats || []).map((c) => ({ Index: '-', Name: c.text + (c.active ? ' (active)' : ''), Description: '' }));
        }
        if (!name) {
            throw new ArgumentError('name required (or pass --list)');
        }

        const nameJson = JSON.stringify(name);
        const switchRes = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const tag = Array.from(document.querySelectorAll('.marketplace-tag'))
        .find((t) => t.offsetParent && (t.textContent || '').trim().toLowerCase().includes(${nameJson}));
      if (!tag) return { ok: false, reason: 'Category not found.' };
      const r = tag.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      tag.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      tag.dispatchEvent(new MouseEvent('mousedown', init));
      tag.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      tag.dispatchEvent(new MouseEvent('mouseup', init));
      tag.dispatchEvent(new MouseEvent('click', init));
      await wait(700);
      return { ok: true, chosen: (tag.textContent || '').trim() };
    })()`);
        if (!switchRes?.ok) {
            throw new CommandExecutionError(switchRes?.reason || 'Category click failed.', SESSION_HINT);
        }

        const items = await page.evaluate(`(function() {
      const cards = Array.from(document.querySelectorAll('.marketplace-card-v2')).filter((c) => c.offsetParent);
      return cards.map((c, i) => {
        const logo = c.querySelector('.skill-logo-svg');
        const name = (logo && logo.getAttribute('aria-label')) || '';
        const full = (c.innerText || '').replace(/\\s+/g, ' ').trim();
        let desc = full;
        if (name && desc.startsWith(name)) desc = desc.slice(name.length).trim();
        return { index: i + 1, name: name || full.split(' ')[0], description: desc.slice(0, 200) };
      });
    })()`);
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        return ((items || []).slice(0, limit)).map((r) => ({ Index: r.index, Name: r.name, Description: r.description }));
    },
});
