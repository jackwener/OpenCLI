// 7 commands for the TRAE SOLO Skills Marketplace panel:
//   skill-list / skill-search / skill-category /
//   skill-install / skill-uninstall / skill-run / skill-toggle
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
//   .card-v2-run-btn  / .card-v2-add-btn         per-card actions (hover-mounted)
//   .installed-switch               on/off toggle per installed card
//   .detail-btn / .detail-btn-danger  Install / Uninstall in detail view

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

// Find a marketplace card by skill name (aria-label of its .skill-logo-svg).
// Returns selector string for the card, OR null if not found.
const cardBySkillJs = (nameLower) => `(function() {
  const cards = Array.from(document.querySelectorAll('.marketplace-card-v2, .installed-card')).filter((c) => c.offsetParent);
  for (const c of cards) {
    const logo = c.querySelector('.skill-logo-svg');
    const n = (logo && logo.getAttribute('aria-label') || '').toLowerCase();
    if (n.includes(${JSON.stringify(nameLower)})) {
      // Tag a stable id for follow-up queries.
      c.setAttribute('data-opencli-target', '1');
      return n;
    }
  }
  return null;
})()`;

// -------- skill-install --------
cli({
    site: 'trae-solo',
    name: 'skill-install',
    access: 'write',
    description: 'Install a Skill from the Marketplace by name (substring match).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name (substring match)' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually install (default is a dry-run)' },
    ],
    columns: ['Status', 'Skill'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        if (!name) throw new ArgumentError('name required');
        const yes = kwargs.yes === true || kwargs.yes === 'true' || kwargs.yes === '1';

        await switchToPanel(page, 'Skills');
        await ensureSkillsTab(page, 'Skills Marketplace');

        const matched = await page.evaluate(cardBySkillJs(name));
        if (!matched) {
            throw new CommandExecutionError(`No marketplace skill matched "${name}".`, SESSION_HINT);
        }
        if (!yes) {
            return [{ Status: 'dry-run (pass --yes to install)', Skill: matched }];
        }

        // Hover card to surface .card-v2-add-btn, then click it. If only the
        // run button is present, the skill is already installed.
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('[data-opencli-target="1"]');
      if (!card) return { ok: false, reason: 'target card lost' };
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await wait(300);
      let btn = card.querySelector('.card-v2-add-btn');
      if (!btn) {
        const run = card.querySelector('.card-v2-run-btn');
        if (run) return { ok: false, reason: 'Skill already installed (has .card-v2-run-btn, no add).' };
        return { ok: false, reason: 'Install button (.card-v2-add-btn) did not mount.' };
      }
      const r = btn.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      btn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      btn.dispatchEvent(new MouseEvent('mousedown', init));
      btn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      btn.dispatchEvent(new MouseEvent('mouseup', init));
      btn.dispatchEvent(new MouseEvent('click', init));
      await wait(800);
      return { ok: true };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Install failed.', SESSION_HINT);
        }
        return [{ Status: 'installed', Skill: matched }];
    },
});

// -------- skill-uninstall --------
cli({
    site: 'trae-solo',
    name: 'skill-uninstall',
    access: 'write',
    description: 'Uninstall a Skill by name (substring match). Opens the card detail then clicks Uninstall.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name (substring match)' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually uninstall (default is a dry-run)' },
    ],
    columns: ['Status', 'Skill'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        if (!name) throw new ArgumentError('name required');
        const yes = kwargs.yes === true || kwargs.yes === 'true' || kwargs.yes === '1';

        await switchToPanel(page, 'Skills');
        await ensureSkillsTab(page, 'Installed');

        const matched = await page.evaluate(cardBySkillJs(name));
        if (!matched) {
            throw new CommandExecutionError(`No installed skill matched "${name}".`, SESSION_HINT);
        }
        if (!yes) {
            return [{ Status: 'dry-run (pass --yes to uninstall)', Skill: matched }];
        }

        // Click card → enter detail → click .detail-btn-danger (text "Uninstall").
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('[data-opencli-target="1"]');
      if (!card) return { ok: false, reason: 'target card lost' };
      const r = card.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + Math.min(50, r.width / 2)),
        clientY: Math.round(r.top + Math.min(30, r.height / 2)),
      };
      card.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      card.dispatchEvent(new MouseEvent('mousedown', init));
      card.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      card.dispatchEvent(new MouseEvent('mouseup', init));
      card.dispatchEvent(new MouseEvent('click', init));
      await wait(1000);

      let uninstall = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        uninstall = Array.from(document.querySelectorAll('.detail-btn-danger, .detail-btn'))
          .find((b) => b.offsetParent && /uninstall|卸载/i.test((b.textContent || '').trim()));
        if (uninstall) break;
        await wait(120);
      }
      if (!uninstall) return { ok: false, reason: 'Uninstall button not found in detail view.' };
      const ur = uninstall.getBoundingClientRect();
      const uinit = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(ur.left + ur.width / 2),
        clientY: Math.round(ur.top + ur.height / 2),
      };
      Promise.resolve().then(() => {
        try {
          uninstall.dispatchEvent(new PointerEvent('pointerdown', { ...uinit, pointerType: 'mouse' }));
          uninstall.dispatchEvent(new MouseEvent('mousedown', uinit));
          uninstall.dispatchEvent(new PointerEvent('pointerup', { ...uinit, pointerType: 'mouse' }));
          uninstall.dispatchEvent(new MouseEvent('mouseup', uinit));
          uninstall.dispatchEvent(new MouseEvent('click', uinit));
        } catch {}
      });
      return { ok: true };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Uninstall failed.', SESSION_HINT);
        }
        await page.wait(1);
        return [{ Status: 'uninstalled', Skill: matched }];
    },
});

// -------- skill-run --------
cli({
    site: 'trae-solo',
    name: 'skill-run',
    access: 'write',
    description: 'Run a Skill directly from its marketplace / installed card.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name (substring match)' },
    ],
    columns: ['Status', 'Skill'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        if (!name) throw new ArgumentError('name required');

        await switchToPanel(page, 'Skills');
        // Run-btn is on Marketplace cards (when installed) — switch to Installed for higher hit rate.
        await ensureSkillsTab(page, 'Installed');

        const matched = await page.evaluate(cardBySkillJs(name));
        if (!matched) {
            throw new CommandExecutionError(`No installed skill matched "${name}". Install first?`, SESSION_HINT);
        }

        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('[data-opencli-target="1"]');
      if (!card) return { ok: false, reason: 'target card lost' };
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(300);
      let btn = card.querySelector('.card-v2-run-btn');
      if (!btn) {
        // Some installed cards put run-btn in detail view — try clicking card itself.
        const run = card.querySelector('button, [role=button]');
        btn = run;
      }
      if (!btn) return { ok: false, reason: 'No run button on card.' };
      const r = btn.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      Promise.resolve().then(() => {
        try {
          btn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
          btn.dispatchEvent(new MouseEvent('mousedown', init));
          btn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
          btn.dispatchEvent(new MouseEvent('mouseup', init));
          btn.dispatchEvent(new MouseEvent('click', init));
        } catch {}
      });
      return { ok: true };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Run failed.', SESSION_HINT);
        }
        return [{ Status: 'run-triggered', Skill: matched }];
    },
});

// -------- skill-toggle --------
cli({
    site: 'trae-solo',
    name: 'skill-toggle',
    access: 'write',
    description: 'Enable/disable an installed Skill via the per-card on/off switch.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name (substring match)' },
        { name: 'state', positional: true, required: false, help: 'Desired state: on or off (omit to toggle)' },
    ],
    columns: ['Status', 'Skill', 'State'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        const wantState = String(kwargs.state || '').trim().toLowerCase();
        if (!name) throw new ArgumentError('name required');
        if (wantState && !['on', 'off'].includes(wantState)) {
            throw new ArgumentError('state must be on or off');
        }

        await switchToPanel(page, 'Skills');
        await ensureSkillsTab(page, 'Installed');

        const matched = await page.evaluate(cardBySkillJs(name));
        if (!matched) {
            throw new CommandExecutionError(`No installed skill matched "${name}".`, SESSION_HINT);
        }

        const wantJson = JSON.stringify(wantState);
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('[data-opencli-target="1"]');
      if (!card) return { ok: false, reason: 'target card lost' };
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(250);
      const sw = card.querySelector('.installed-switch');
      if (!sw) return { ok: false, reason: 'switch (.installed-switch) not present on card.' };
      const currentlyOn = sw.className.includes('on');
      const want = ${wantJson};
      if (want === 'on' && currentlyOn) return { ok: true, noop: true, state: 'on' };
      if (want === 'off' && !currentlyOn) return { ok: true, noop: true, state: 'off' };
      const r = sw.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      sw.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      sw.dispatchEvent(new MouseEvent('mousedown', init));
      sw.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      sw.dispatchEvent(new MouseEvent('mouseup', init));
      sw.dispatchEvent(new MouseEvent('click', init));
      await wait(400);
      const finalOn = (document.querySelector('[data-opencli-target="1"] .installed-switch') || {}).className?.includes('on');
      return { ok: true, state: finalOn ? 'on' : 'off' };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Toggle failed.', SESSION_HINT);
        }
        return [{ Status: result.noop ? 'no-op' : 'toggled', Skill: matched, State: result.state }];
    },
});
