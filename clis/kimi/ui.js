// Sidebar / mode-navigation commands for Kimi.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    KIMI_DOMAIN,
    KIMI_URL,
    IS_VISIBLE_JS,
    ensureOnKimi,
    clickBySvgNameScript,
    navByHrefScript,
} from './_utils.js';

const UI_COLUMNS = ['Mode', 'Status', 'Url', 'Field', 'Value', 'Index', 'Model', 'Active'];

// Kimi exposes 7 specialized work modes via sidebar links.
// Mapping: cli name → URL hash
const MODES = {
    ppt: '/slides',
    docs: '/docs',
    'deep-research': '/deep-research',
    websites: '/websites',
    sheets: '/sheets',
    'agent-swarm': '/agent-swarm',
    code: '/code',
};

// -------- mode --------
cli({
    site: 'kimi',
    name: 'mode',
    access: 'write',
    description: 'Switch to a Kimi work mode: ppt | docs | deep-research | websites | sheets | agent-swarm | code. With no argument, lists modes.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'name', positional: true, required: false, help: 'Mode name (omit to list all)' },
    ],
    columns: UI_COLUMNS,
    func: async (page, kwargs) => {
        const name = String(kwargs?.name || '').trim().toLowerCase();
        if (!name) {
            return Object.entries(MODES).map(([m, url]) => ({
                Mode: m,
                Status: 'available',
                Url: KIMI_URL + url.slice(1),
            }));
        }
        const target = MODES[name];
        if (!target) {
            throw new ArgumentError('name', `unknown mode "${name}". Known: ${Object.keys(MODES).join(', ')}`);
        }
        await ensureOnKimi(page);
        await page.goto(`${KIMI_URL}${target.slice(1)}`);
        await page.wait(1);
        const url = await page.evaluate('window.location.href');
        return [{ Mode: name, Status: 'navigated', Url: String(url || '') }];
    },
});

// -------- sidebar-toggle --------
cli({
    site: 'kimi',
    name: 'sidebar-toggle',
    access: 'write',
    description: 'Click the LeftBar svg to toggle the Kimi sidebar.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: UI_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const res = await page.evaluate(clickBySvgNameScript('LeftBar', { last: false }));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'LeftBar svg not visible', '');
        return [{ Status: 'toggled' }];
    },
});

// -------- view-all-history --------
cli({
    site: 'kimi',
    name: 'view-all-history',
    access: 'write',
    description: 'Navigate to /chat/history (full conversation list page).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: UI_COLUMNS,
    func: async (page) => {
        await page.goto(`${KIMI_URL}chat/history`);
        await page.wait(1);
        const url = await page.evaluate('window.location.href');
        return [{ Status: 'navigated', Url: String(url || '') }];
    },
});

// -------- settings --------
cli({
    site: 'kimi',
    name: 'settings',
    access: 'write',
    description: 'Open the Kimi settings page (/settings).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: UI_COLUMNS,
    func: async (page) => {
        await page.goto(`${KIMI_URL}settings`);
        await page.wait(1);
        const url = await page.evaluate('window.location.href');
        return [{ Status: 'navigated', Url: String(url || '') }];
    },
});

// -------- account --------
cli({
    site: 'kimi',
    name: 'account',
    access: 'read',
    description: 'Read account info from the Kimi sidebar (display name + plan label, e.g. "Allegretto").',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: UI_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const data = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const avatar = document.querySelector('img[src*="avatar.moonshot.cn"]');
      if (!avatar) return null;
      // The display name + plan are siblings in a parent container.
      let container = avatar;
      for (let i = 0; i < 5; i++) { if (container.parentElement) container = container.parentElement; }
      const spans = Array.from(container.querySelectorAll('span, div')).filter(isVisible)
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter((t) => t && t.length < 60);
      const uniq = [...new Set(spans)];
      return {
        avatarUrl: avatar.src,
        avatarAlt: avatar.alt || '',
        labels: uniq.slice(0, 10),
      };
    })()`);
        if (!data) {
            throw new CommandExecutionError('No avatar found — not logged in?', '');
        }
        const rows = [
            { Field: 'AvatarAlt', Value: data.avatarAlt || '(none)' },
            { Field: 'AvatarUrl', Value: data.avatarUrl },
        ];
        data.labels.forEach((l, i) => rows.push({ Field: `Label[${i + 1}]`, Value: l }));
        return rows;
    },
});

// -------- model --------
cli({
    site: 'kimi',
    name: 'model',
    access: 'write',
    description: 'Read the current Kimi model (e.g. "K2.6 思考") or switch by clicking the model dropdown. With no argument, returns current; with --list, opens dropdown + lists; with --set <name>, switches.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'list', type: 'boolean', default: false, help: 'Open model dropdown + list options' },
        { name: 'set', required: false, help: 'Substring (case-insensitive) of model to switch to' },
    ],
    columns: UI_COLUMNS,
    func: async (page, kwargs) => {
        await ensureOnKimi(page);
        const wantList = kwargs?.list === true || kwargs?.list === 'true';
        const wantSet = String(kwargs?.set || '').trim();

        // Read current model label from the composer toolbar.
        const cur = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      // The model button is a div containing a Down_b svg + a span with model name.
      const svgs = Array.from(document.querySelectorAll('svg[name="Down_b"]')).filter(isVisible);
      for (const svg of svgs) {
        let p = svg.parentElement;
        for (let i = 0; i < 4 && p; i++) {
          const spans = p.querySelectorAll('span');
          for (const s of spans) {
            const t = (s.textContent || '').trim();
            if (/^K\\d|^Kimi |^Pro\\b|^Auto/.test(t)) return t;
          }
          p = p.parentElement;
        }
      }
      return '';
    })()`);
        if (!wantList && !wantSet) {
            return [{ Index: 1, Model: cur || '(unknown)', Active: 'yes' }];
        }

        // Open the dropdown by clicking the Down_b svg next to the model name.
        await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const svgs = Array.from(document.querySelectorAll('svg[name="Down_b"]')).filter(isVisible);
      // The model trigger is usually the one with a sibling span starting with "K"
      for (const svg of svgs) {
        let p = svg.parentElement;
        for (let i = 0; i < 4 && p; i++) {
          const spans = p.querySelectorAll('span');
          const match = Array.from(spans).find((s) => /^K\\d|^Kimi |^Pro\\b|^Auto/.test((s.textContent || '').trim()));
          if (match) {
            p.click();
            return;
          }
          p = p.parentElement;
        }
      }
    })()`);
        await page.wait(0.5);
        const opts = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      // Dropdown items appear in a floating popover.
      const popovers = Array.from(document.querySelectorAll('[class*="popover"i], [class*="dropdown"i], [role="menu"], [role="listbox"]')).filter(isVisible)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 600 && r.height < 600; });
      if (!popovers.length) return [];
      const pop = popovers[popovers.length - 1];
      return Array.from(pop.querySelectorAll('div, li, button, [role="option"], [role="menuitem"]'))
        .filter(isVisible)
        .map((el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' '))
        .filter((t) => t && t.length < 80 && (/K\\d|Kimi|Pro\\b|Auto|思考/.test(t)))
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 20);
    })()`);

        if (wantSet) {
            const normalizeModel = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9.\u4e00-\u9fa5]+/g, '');
            const needle = normalizeModel(wantSet);
            const exactIdx = opts.findIndex((t) => normalizeModel(t) === needle);
            const partialMatches = exactIdx >= 0 ? [] : opts
                .map((model, index) => ({ model, index }))
                .filter((item) => normalizeModel(item.model).includes(needle));
            if (exactIdx < 0 && partialMatches.length > 1) {
                try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
                throw new ArgumentError('set', `Model "${wantSet}" is ambiguous: ${partialMatches.map(item => item.model).join(', ')}`);
            }
            const idx = exactIdx >= 0 ? exactIdx : partialMatches[0]?.index ?? -1;
            if (idx < 0) {
                try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
                throw new ArgumentError('set', `No model matched "${wantSet}". Available: ${opts.join(', ')}`);
            }
            const clickRes = await page.evaluate(`(() => {
        ${IS_VISIBLE_JS}
        const popovers = Array.from(document.querySelectorAll('[class*="popover"i], [class*="dropdown"i], [role="menu"], [role="listbox"]')).filter(isVisible);
        const pop = popovers[popovers.length - 1];
        if (!pop) return { ok: false };
        const items = Array.from(pop.querySelectorAll('div, li, button, [role="option"], [role="menuitem"]'))
          .filter(isVisible)
          .filter((el) => { const t = (el.innerText || '').trim(); return t && t.length < 80 && (/K\\d|Kimi|Pro\\b|Auto|思考/.test(t)); });
        const target = items[${idx}];
        if (!target) return { ok: false };
        target.click();
        return { ok: true, clicked: (target.innerText || '').trim() };
            })()`);
            if (!clickRes?.ok) throw new CommandExecutionError('Failed to click model option', '');
            await page.wait(0.5);
            const verified = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const svgs = Array.from(document.querySelectorAll('svg[name="Down_b"]')).filter(isVisible);
      for (const svg of svgs) {
        let p = svg.parentElement;
        for (let i = 0; i < 4 && p; i++) {
          const spans = p.querySelectorAll('span');
          for (const s of spans) {
            const t = (s.textContent || '').trim();
            if (/^K\\d|^Kimi |^Pro\\b|^Auto/.test(t)) return t;
          }
          p = p.parentElement;
        }
      }
      return '';
    })()`);
            if (normalizeModel(verified) !== normalizeModel(clickRes.clicked)) {
                throw new CommandExecutionError(
                    `Kimi model switch did not verify the requested model: requested "${wantSet}", current "${verified || 'not visible'}"`,
                    'Open the Kimi model menu and verify the requested model is selectable, then retry.',
                );
            }
            return [{ Index: 1, Model: clickRes.clicked, Active: 'switched' }];
        }

        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!opts.length) {
            throw new EmptyResultError('kimi model', 'Model dropdown opened but no options detected.');
        }
        return opts.map((m, i) => ({ Index: i + 1, Model: m, Active: m === cur ? 'yes' : '' }));
    },
});
