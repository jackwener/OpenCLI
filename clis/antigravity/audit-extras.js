// Deep-audit gap closers for Antigravity (port 9234).
//
// Live snapshot of CodexBar agent project (chat view) showed 49 visible
// interactive elements / 28 unique labels. Beyond the 12 existing
// commands, these 10 wrap the rest:
//
//   react <good|bad>      — Good response / Bad response
//   copy-message          — text of last assistant turn (clicks last visible Copy)
//   copy-code [--index N] — copy a specific code block (uses Copy code button)
//   settings              — click the settings-button data-testid
//   sidebar-toggle        — click Toggle Sidebar
//   nav <back|forward>    — Go Back / Go Forward
//   toggle-aux            — Toggle Auxiliary Pane
//   display-options       — open Display Options menu + list items
//   add-context           — click Add context (opens file/url picker)
//   revert                — click revert-button (per-message revert)

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './_actions.js';

function clickFirstScript(sels) {
    return `(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    for (const sel of ${JSON.stringify(sels)}) {
      const t = Array.from(document.querySelectorAll(sel)).filter(isVis)[0];
      if (t) {
        const r = t.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        t.dispatchEvent(new PointerEvent('pointerdown', opts));
        t.dispatchEvent(new MouseEvent('mousedown', opts));
        t.dispatchEvent(new PointerEvent('pointerup', opts));
        t.dispatchEvent(new MouseEvent('mouseup', opts));
        t.click();
        return { ok: true, sel };
      }
    }
    return { ok: false, reason: 'No matching visible element.' };
  })()`;
}

function clickLastScript(sels) {
    return `(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    for (const sel of ${JSON.stringify(sels)}) {
      const found = Array.from(document.querySelectorAll(sel)).filter(isVis);
      if (found.length) {
        const t = found[found.length - 1];
        const r = t.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        t.dispatchEvent(new PointerEvent('pointerdown', opts));
        t.dispatchEvent(new MouseEvent('mousedown', opts));
        t.dispatchEvent(new PointerEvent('pointerup', opts));
        t.dispatchEvent(new MouseEvent('mouseup', opts));
        t.click();
        return { ok: true, sel };
      }
    }
    return { ok: false, reason: 'No matching visible element.' };
  })()`;
}

// -------- react --------
cli({
    site: 'antigravity',
    name: 'react',
    access: 'write',
    description: 'Click "Good response" or "Bad response" on the LAST assistant message.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'kind', positional: true, required: true, help: 'good or bad' },
    ],
    columns: ['Status', 'Reaction'],
    func: async (page, kwargs) => {
        const kind = String(kwargs?.kind || '').trim().toLowerCase();
        if (kind !== 'good' && kind !== 'bad') throw new ArgumentError('kind', 'must be "good" or "bad"');
        const label = kind === 'good' ? 'Good response' : 'Bad response';
        const res = unwrapEvaluateResult(await page.evaluate(clickLastScript([`button[aria-label="${label}"]`])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `${label} click failed`, '');
        return [{ Status: 'clicked', Reaction: kind }];
    },
});

// -------- copy-message --------
cli({
    site: 'antigravity',
    name: 'copy-message',
    access: 'write',
    description: 'Return the text of the last assistant message (best-effort: walks up from the last visible Copy button).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'click-button', type: 'boolean', default: false, help: 'Also click the in-UI Copy button' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const data = unwrapEvaluateResult(await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // Antigravity has both "Copy" (message) and "Copy code" (code block) buttons.
      // We want the bottom-of-message Copy, not the code-block Copy.
      const copies = Array.from(document.querySelectorAll('button[aria-label="Copy"]')).filter(isVis);
      if (!copies.length) return null;
      const lastCopy = copies[copies.length - 1];
      let container = lastCopy;
      let best = '';
      for (let i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        const txt = (container.innerText || '').trim();
        if (txt.length > best.length) best = txt;
        if (best.length > 200) break;
      }
      return { text: best };
    })()`));
        if (!data) throw new EmptyResultError('antigravity copy-message', 'No Copy buttons visible — make sure an assistant reply is on screen.');
        if (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') {
            const clickResult = unwrapEvaluateResult(await page.evaluate(clickLastScript(['button[aria-label="Copy"]'])));
            if (!clickResult?.ok) {
                throw new CommandExecutionError(clickResult?.reason || 'Copy button click failed', '');
            }
        }
        return [
            { Field: 'Length', Value: String((data.text || '').length) + ' chars' },
            { Field: 'ClipboardClicked', Value: (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') ? 'yes' : 'no' },
            { Field: 'Text', Value: data.text || '' },
        ];
    },
});

// -------- copy-code --------
cli({
    site: 'antigravity',
    name: 'copy-code',
    access: 'read',
    description: 'Return the text of a code block in the current conversation. Default: last code block; pass --index N (1-based from top) to pick a specific one.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'index', type: 'int', required: false, help: '1-based index of code block (default: last)' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const idx = Number.isInteger(kwargs?.index) ? kwargs.index : null;
        const data = unwrapEvaluateResult(await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const btns = Array.from(document.querySelectorAll('button[aria-label="Copy code"]')).filter(isVis);
      if (!btns.length) return null;
      const idx = ${idx === null ? 'btns.length - 1' : (idx - 1)};
      const btn = btns[idx];
      if (!btn) return { err: 'index ' + (${idx} ?? 'last') + ' out of range. Have ' + btns.length + ' code blocks.' };
      // Find the <code> or <pre> element inside the parent block.
      let container = btn;
      for (let i = 0; i < 6 && container.parentElement; i++) container = container.parentElement;
      const code = container.querySelector('pre, code');
      return { text: code ? (code.innerText || '').trim() : (container.innerText || '').trim(), total: btns.length };
    })()`));
        if (!data) throw new EmptyResultError('antigravity copy-code', 'No code blocks visible.');
        if (data.err) throw new CommandExecutionError(data.err, '');
        return [
            { Field: 'TotalCodeBlocks', Value: String(data.total) },
            { Field: 'PickedIndex', Value: String(idx === null ? data.total : idx) },
            { Field: 'Length', Value: String((data.text || '').length) + ' chars' },
            { Field: 'Code', Value: data.text || '' },
        ];
    },
});

// -------- settings --------
cli({
    site: 'antigravity',
    name: 'settings',
    access: 'write',
    description: 'Click the Antigravity settings button (matched by data-testid="settings-button").',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript([
            '[data-testid="settings-button"]',
            'button[aria-label="Settings"]',
        ])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'settings click failed', '');
        await page.wait(0.6);
        return [{ Status: `clicked via ${res.sel}` }];
    },
});

// -------- sidebar-toggle --------
cli({
    site: 'antigravity',
    name: 'sidebar-toggle',
    access: 'write',
    description: 'Click Toggle Sidebar (collapses/expands the Antigravity sidebar).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript(['button[aria-label="Toggle Sidebar"]'])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'sidebar-toggle failed', '');
        return [{ Status: 'toggled' }];
    },
});

// -------- nav --------
cli({
    site: 'antigravity',
    name: 'nav',
    access: 'write',
    description: 'Click Go Back or Go Forward (Antigravity in-app history).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'direction', positional: true, required: true, help: 'back or forward' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const dir = String(kwargs?.direction || '').trim().toLowerCase();
        if (dir !== 'back' && dir !== 'forward') throw new ArgumentError('direction', 'must be "back" or "forward"');
        const label = dir === 'back' ? 'Go Back' : 'Go Forward';
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript([`button[aria-label="${label}"]`])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `${label} click failed`, '');
        return [{ Status: `${dir} clicked` }];
    },
});

// -------- toggle-aux --------
cli({
    site: 'antigravity',
    name: 'toggle-aux',
    access: 'write',
    description: 'Toggle the Auxiliary Pane (Antigravity\'s secondary panel for code/preview).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript(['button[aria-label="Toggle Auxiliary Pane"]'])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'toggle-aux failed', '');
        return [{ Status: 'toggled' }];
    },
});

// -------- display-options --------
cli({
    site: 'antigravity',
    name: 'display-options',
    access: 'read',
    description: 'Open the Display Options menu and list its items.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript(['button[aria-label="Display Options"]'])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'display-options click failed', '');
        await page.wait(0.4);
        // Antigravity renders Display Options as a [role="dialog"] popover,
        // NOT a [role="menu"]. Search both. Among visible candidates, prefer
        // the most-recently-mounted small popover (not a full-page dialog).
        const items = unwrapEvaluateResult(await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const candidates = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [class*="popover"i]'))
        .filter(isVis)
        // Filter out app-shell dialogs (huge ones); prefer small popovers (<600px wide).
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 600 && r.height < 600;
        });
      if (!candidates.length) return [];
      // The popover is usually the LAST one mounted (highest in DOM order).
      const menu = candidates[candidates.length - 1];
      return Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], button'))
        .filter(isVis)
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
    })()`));
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('antigravity display-options', 'Menu opened but no items detected.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});

// -------- add-context --------
cli({
    site: 'antigravity',
    name: 'add-context',
    access: 'write',
    description: 'Click the Add context button in the composer (opens file/URL picker for context attachment).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript(['button[aria-label="Add context"]'])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'add-context click failed', '');
        await page.wait(0.4);
        return [{ Status: 'clicked — picker should be open' }];
    },
});

// -------- revert --------
cli({
    site: 'antigravity',
    name: 'revert',
    access: 'write',
    description: 'Click the revert button (per-message revert for agent changes). Requires --yes (this modifies your workspace).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually revert (default: dry-run)' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to revert (modifies workspace)' }];
        }
        const res = unwrapEvaluateResult(await page.evaluate(clickFirstScript(['[data-testid="revert-button"]', 'button[aria-label="Revert"]'])));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'revert click failed', '');
        await page.wait(1);
        return [{ Status: 'reverted' }];
    },
});
