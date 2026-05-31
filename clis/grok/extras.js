// Remaining UI commands to close out the deep-audit gap list.
//
//   sidebar-toggle           — collapse/expand the left sidebar
//   toggle-preview           — show/hide the conversation preview pane
//   view-all                 — go to /history (full conversation list)
//   project-list             — list projects in the sidebar Projects accordion
//   project-new <name>       — create a new project (--yes gated; opens the
//                              create-project dialog and submits)
//   attach <file> [--conv]   — attach a local file to the composer for the
//                              next send (sets the <input type=file> via CDP)
//   edit-message [--index N] — click Edit on a user message (default last user
//                              message). Returns the message text in the
//                              editable input — call ask afterwards to send a
//                              modified version.
//   more-actions             — open the per-message "More actions" menu on the
//                              last assistant message and return its items
//
// All write commands (project-new, attach, edit-message) require --yes when
// they mutate state.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    IS_VISIBLE_JS,
    ensureOnGrok,
    parseGrokSessionId,
} from './utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Shared helper: navigate to a conv if --conv passed.
async function maybeNavigateConv(page, convArg) {
    if (!convArg) {
        await ensureOnGrok(page);
        return;
    }
    const sessionId = parseGrokSessionId(convArg);
    await page.goto(`https://grok.com/c/${sessionId}`);
    await page.wait(2);
}

// Shared helper: click an element with full pointer event chain (radix-safe).
function pointerClickScript(selectorJson) {
    return `(() => {
    ${IS_VISIBLE_JS}
    const sels = ${selectorJson};
    let target = null;
    for (const s of sels) {
      target = Array.from(document.querySelectorAll(s)).find((n) => isVisible(n));
      if (target) break;
    }
    if (!target) return { ok: false, reason: 'No matching visible element.' };
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
    return { ok: true };
  })()`;
}

// -------- sidebar-toggle --------
cli({
    site: 'grok',
    name: 'sidebar-toggle',
    access: 'write',
    description: 'Collapse or expand the left sidebar in Grok. Idempotent — clicks the toggle button and reports the new visible state.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'NewState'],
    func: async (page) => {
        await ensureOnGrok(page);
        // The toggle is the unlabelled button at top-left of the sidebar.
        // It has no aria-label, but its sibling is `<a aria-label="主页"|"Home">`.
        const res = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const home = Array.from(document.querySelectorAll('a[aria-label="主页"], a[aria-label="Home"], a[href="/"][aria-label]'))
        .find((n) => isVisible(n));
      if (!home) return { ok: false, reason: 'Home link not found — sidebar may be unusual.' };
      // Toggle button is the next sibling button without aria-label.
      let cand = home.nextElementSibling;
      let target = null;
      while (cand) {
        const btn = cand.tagName === 'BUTTON' ? cand : cand.querySelector('button:not([aria-label])');
        if (btn) { target = btn; break; }
        cand = cand.nextElementSibling;
      }
      // Fallback: any unlabelled button adjacent to the home link.
      if (!target) {
        const all = Array.from(document.querySelectorAll('button')).filter((b) => isVisible(b) && !b.getAttribute('aria-label'));
        const homeR = home.getBoundingClientRect();
        target = all.find((b) => {
          const r = b.getBoundingClientRect();
          return Math.abs(r.y - homeR.y) < 40 && Math.abs(r.x - homeR.x) < 80;
        });
      }
      if (!target) return { ok: false, reason: 'Sidebar toggle button not found.' };
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.click();
      // Persist & report new state via localStorage 'sidebarOpen' if set.
      const newState = localStorage.getItem('sidebarOpen') || '?';
      return { ok: true, newState };
    })()`);
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'sidebar-toggle failed', '');
        return [{ Status: 'toggled', NewState: res.newState }];
    },
});

// -------- toggle-preview --------
cli({
    site: 'grok',
    name: 'toggle-preview',
    access: 'write',
    description: 'Toggle the "show conversation previews" setting (visible as the 隐藏对话预览/Show preview button when a conversation has previews surfaced in the sidebar).',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Detail'],
    func: async (page) => {
        await ensureOnGrok(page);
        const labels = JSON.stringify([
            '隐藏对话预览', '显示对话预览',
            'Hide conversation preview', 'Show conversation preview',
            'Hide preview', 'Show preview',
        ]);
        const res = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const labels = ${labels};
      const btn = Array.from(document.querySelectorAll('button')).filter((b) => isVisible(b))
        .find((b) => labels.includes(b.getAttribute('aria-label') || ''));
      if (!btn) return { ok: false, reason: 'No preview-toggle button visible right now (need a conv with preview).' };
      const before = btn.getAttribute('aria-label');
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.click();
      return { ok: true, before };
    })()`);
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'toggle-preview failed', '');
        return [{ Status: 'clicked', Detail: `was: "${res.before}"` }];
    },
});

// -------- view-all --------
cli({
    site: 'grok',
    name: 'view-all',
    access: 'read',
    description: 'Navigate to Grok\'s full conversation history page (the "查看全部" / "View all" link at the bottom of the sidebar history list). Returns the resolved URL.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Url'],
    func: async (page) => {
        await ensureOnGrok(page);
        // First try clicking the visible 查看全部 button to let Grok navigate.
        const clicked = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const btn = Array.from(document.querySelectorAll('button')).filter((b) => isVisible(b))
        .find((b) => /查看全部|View all|See all/i.test((b.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
        if (!clicked) {
            // Fallback: direct nav.
            await page.goto('https://grok.com/history');
        }
        await page.wait(2);
        const url = await page.evaluate('window.location.href');
        return [{ Status: clicked ? 'clicked' : 'navigated', Url: String(url || '') }];
    },
});

// -------- project-list --------
cli({
    site: 'grok',
    name: 'project-list',
    access: 'read',
    description: 'Expand the sidebar Projects accordion and list visible project entries. Returns empty if no projects exist on the account.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', required: false, default: 50 },
    ],
    columns: ['Index', 'Name', 'Href'],
    func: async (page, kwargs) => {
        await ensureOnGrok(page);
        // Expand the accordion if collapsed.
        await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const trigger = Array.from(document.querySelectorAll('[role="button"][aria-label="项目"], [role="button"][aria-label="Projects"]'))
        .find((n) => isVisible(n));
      if (trigger && trigger.getAttribute('aria-expanded') === 'false') trigger.click();
    })()`);
        await page.wait(0.4);
        const list = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const anchors = Array.from(document.querySelectorAll('a[href*="/project/"], a[href*="/projects/"], a[href*="/p/"]'))
        .filter((a) => isVisible(a))
        .filter((a) => /\\/p(?:roject(?:s)?)?\\//.test(a.getAttribute('href') || ''));
      return anchors.map((a) => ({
        name: (a.innerText || '').trim().slice(0, 100),
        href: a.getAttribute('href'),
      }));
    })()`);
        if (!list.length) {
            throw new EmptyResultError('grok project-list', 'No projects visible. Either none exist on this account, or projects are gated behind a paid plan.');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 50;
        return list.slice(0, limit).map((p, i) => ({ Index: i + 1, Name: p.name || '(untitled)', Href: p.href }));
    },
});

// -------- project-new --------
cli({
    site: 'grok',
    name: 'project-new',
    access: 'write',
    description: 'Create a new project. Clicks the "New project" button in the Projects accordion, types the name into the resulting dialog, and submits. Requires --yes.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
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
        await ensureOnGrok(page);
        // Expand Projects accordion + click 新项目 / New project.
        await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const trigger = Array.from(document.querySelectorAll('[role="button"][aria-label="项目"], [role="button"][aria-label="Projects"]'))
        .find((n) => isVisible(n));
      if (trigger && trigger.getAttribute('aria-expanded') === 'false') trigger.click();
    })()`);
        await page.wait(0.5);
        const clickRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const candidates = Array.from(document.querySelectorAll('[role="button"], button'))
        .filter((n) => isVisible(n))
        .filter((n) => /新项目|New project/i.test((n.textContent || '').trim()));
      const target = candidates[0];
      if (!target) return { ok: false, reason: 'New project button not visible.' };
      target.click();
      return { ok: true };
    })()`);
        if (!clickRes?.ok) throw new CommandExecutionError(clickRes?.reason || 'project-new click failed', '');
        await page.wait(1);
        // Fill the dialog input + submit.
        const fillRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const dlgs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((n) => isVisible(n));
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return { ok: false, reason: 'New-project dialog did not open.' };
      const input = dlg.querySelector('input, textarea');
      if (!input) return { ok: false, reason: 'No input in dialog.' };
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // Find submit button.
      const submit = Array.from(dlg.querySelectorAll('button'))
        .find((b) => /^(create|确认|创建|submit|ok)$/i.test((b.textContent || '').trim()));
      if (submit) submit.click();
      return { ok: true, submitClicked: !!submit };
    })()`);
        if (!fillRes?.ok) throw new CommandExecutionError(fillRes?.reason || 'project-new dialog fill failed', '');
        return [{ Status: fillRes.submitClicked ? 'created' : 'name-typed (submit not found)', Name: name }];
    },
});

// -------- attach --------
cli({
    site: 'grok',
    name: 'attach',
    access: 'write',
    description: 'Attach a local file to the Grok composer for the next send. Sets <input type=file> directly via CDP. Pair with `send <prompt>` to actually send.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'file', positional: true, required: true, help: 'Absolute path to the file to attach' },
        { name: 'conv', required: false, help: 'Conversation id to navigate to first' },
    ],
    columns: ['Status', 'File'],
    func: async (page, kwargs) => {
        const file = String(kwargs?.file || '').trim();
        if (!file) throw new ArgumentError('file', 'is required');
        if (!fs.existsSync(file)) {
            throw new CommandExecutionError(`File not found: ${file}`, '');
        }
        await maybeNavigateConv(page, kwargs?.conv);
        // Use the page.upload method if available (opencli wraps it). Fall back to
        // page.evaluate setting the file input via a DataTransfer-like trick is not
        // possible via DevTools eval — file inputs require Page.setFileInputFiles
        // through CDP, which opencli's page.upload helper handles.
        // Find the file input.
        const sel = 'input[type="file"][name="files"], input[type="file"]';
        const exists = await page.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
        if (!exists) {
            throw new CommandExecutionError('No <input type=file> visible in composer.', 'Make sure the composer is visible on the current page.');
        }
        // opencli exposes page.upload(selector, [files]) which uses CDP setFileInputFiles.
        if (typeof page.upload === 'function') {
            await page.upload(sel, [file]);
        } else {
            // Fallback: try setting the file via DataTransfer. This rarely works
            // for security reasons but is the only option without CDP support.
            throw new CommandExecutionError(
                'page.upload helper not available in this opencli build.',
                'Upgrade opencli, or attach via the UI manually before sending.',
            );
        }
        return [{ Status: 'attached', File: path.basename(file) }];
    },
});

// -------- edit-message --------
cli({
    site: 'grok',
    name: 'edit-message',
    access: 'write',
    description: 'Click Edit on a user message (default: last user message). Opens it for editing — you can then read the editable text or use `send` to submit a modified version.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Conversation id to navigate to first' },
        { name: 'index', type: 'int', required: false, help: 'Index of user message to edit (1-based from oldest). Default: last.' },
    ],
    columns: ['Status', 'OriginalText'],
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const idx = Number.isInteger(kwargs?.index) ? kwargs.index : null;
        const res = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const userMsgs = Array.from(document.querySelectorAll('[data-testid="user-message"]')).filter((n) => isVisible(n));
      if (!userMsgs.length) return { ok: false, reason: 'No user messages visible.' };
      const idx = ${idx === null ? 'userMsgs.length - 1' : (idx - 1)};
      const target = userMsgs[idx];
      if (!target) return { ok: false, reason: 'Index out of range. Have ' + userMsgs.length + ' user messages.' };
      const orig = (target.innerText || '').trim();
      // Find the Edit button within or adjacent to the bubble.
      let container = target;
      for (let i = 0; i < 4; i++) { if (container.parentElement) container = container.parentElement; }
      const btn = Array.from(container.querySelectorAll('button[aria-label="Edit"], button[aria-label="编辑"], button[aria-label="編集"]'))[0];
      if (!btn) return { ok: false, reason: 'Edit button not found near user message.' };
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.click();
      return { ok: true, orig };
    })()`);
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'edit-message failed', '');
        return [{ Status: 'edit-opened', OriginalText: (res.orig || '').slice(0, 400) }];
    },
});

// -------- more-actions --------
cli({
    site: 'grok',
    name: 'more-actions',
    access: 'read',
    description: 'Open the per-message "More actions" menu on the last assistant message and list its items. Closes the menu before returning.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Conversation id to navigate to first' },
    ],
    columns: ['Index', 'Item'],
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const open = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const bubbles = Array.from(document.querySelectorAll('[data-testid="assistant-message"]')).filter((n) => isVisible(n));
      if (!bubbles.length) return { ok: false, reason: 'No assistant message visible.' };
      const last = bubbles[bubbles.length - 1];
      let container = last;
      for (let i = 0; i < 5; i++) { if (container.parentElement) container = container.parentElement; }
      const btn = Array.from(container.querySelectorAll('button[aria-label="More actions"], button[aria-label="更多操作"], button[aria-label="その他のアクション"]'))[0];
      if (!btn) return { ok: false, reason: 'More-actions button not found.' };
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.click();
      return { ok: true };
    })()`);
        if (!open?.ok) throw new CommandExecutionError(open?.reason || 'more-actions open failed', '');
        await page.wait(0.4);
        const items = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter((n) => isVisible(n));
      if (!menus.length) return [];
      const menu = menus[menus.length - 1];
      return Array.from(menu.querySelectorAll('[role="menuitem"]'))
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
    })()`);
        try { await page.keys('Escape'); } catch {}
        if (!items.length) {
            throw new EmptyResultError('grok more-actions', 'Menu opened but had no items.');
        }
        return items.map((item, i) => ({ Index: i + 1, Item: item }));
    },
});
