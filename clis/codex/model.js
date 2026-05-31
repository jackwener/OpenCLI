import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

// Codex Desktop App exposes the active model + reasoning level on a button
// in the composer bottom toolbar. As of 2026-05-31 the button has no
// stable aria-label or data-testid — we anchor to it by walking up from
// the composer contenteditable and finding the button whose visible text
// matches a known pattern (model version like "5.5"/"5.4" OR reasoning
// level "Low"/"Medium"/"High"/"Extra High"/"Auto"/"Speed").
//
// Clicking the button opens a menu with BOTH:
//   - Reasoning levels:  Low / Medium / High / Extra High / Speed / Auto
//   - Model versions:    GPT-5.5 / GPT-5.4 / ...
// Either kind of value can be selected via 'opencli codex model <name>'.

const MODEL_BTN_TEXT_RE = /5\.\d|[Ee]xtra [Hh]igh|^High$|^Medium$|^Low$|^Auto$|^Fast$|^Speed$|^Pro$|GPT-/;
const MODEL_BTN_PATTERN = MODEL_BTN_TEXT_RE.source;

export const modelCommand = cli({
    site: 'codex',
    name: 'model',
    access: 'write',
    description: 'Read, list, or switch the active model / reasoning level in Codex Desktop. The composer toolbar button toggles a menu that mixes model variants (GPT-5.5, Speed) with reasoning levels (Low/Medium/High/Extra High).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', required: false, positional: true, help: 'Substring (case-insensitive) of a model / reasoning level to switch to. Omit to read current.' },
        { name: 'list', type: 'boolean', default: false, help: 'List all menu options (does not switch)' },
    ],
    columns: ['Status', 'Model'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        const listOnly = kwargs.list === true || kwargs.list === 'true';
        const patternJson = JSON.stringify(MODEL_BTN_PATTERN);

        const current = await page.evaluate(`(function() {
      const re = new RegExp(${patternJson});
      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter((el) => el.offsetParent);
      const last = composers[composers.length - 1];
      if (!last) return '';
      let root = last;
      for (let i = 0; i < 5; i++) root = root.parentElement || root;
      const btns = Array.from(root.querySelectorAll('button')).filter((b) => b.offsetParent);
      const match = btns.find((b) => re.test((b.textContent || '').trim()));
      return match ? (match.textContent || '').trim() : '';
    })()`);
        if (!current) {
            throw selectorError('Codex model button (composer toolbar). Make sure a chat is open.');
        }

        if (!name && !listOnly) {
            return [{ Status: 'Active', Model: current }];
        }

        const namejson = JSON.stringify(name);
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const re = new RegExp(${patternJson});
      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter((el) => el.offsetParent);
      const last = composers[composers.length - 1];
      if (!last) return { ok: false, reason: 'composer not found' };
      let root = last;
      for (let i = 0; i < 5; i++) root = root.parentElement || root;
      const btns = Array.from(root.querySelectorAll('button')).filter((b) => b.offsetParent);
      const trigger = btns.find((b) => re.test((b.textContent || '').trim()));
      if (!trigger) return { ok: false, reason: 'model trigger button not found in composer' };

      const r = trigger.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      trigger.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      trigger.dispatchEvent(new MouseEvent('mousedown', init));
      trigger.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      trigger.dispatchEvent(new MouseEvent('mouseup', init));
      trigger.dispatchEvent(new MouseEvent('click', init));

      let items = [];
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await wait(80);
        items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
          .filter((it) => it instanceof HTMLElement && it.offsetParent);
        if (items.length) break;
      }
      if (!items.length) {
        return { ok: false, reason: 'Model menu did not open after click.' };
      }

      function leadingText(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('kbd').forEach((k) => k.remove());
        return (clone.textContent || '').trim();
      }
      // Filter unrelated Chat-actions menu items so they don't pollute
      // the model list — Codex sometimes shares the menu root with
      // 'Pin chat / Rename chat / Archive chat / Open side chat / Copy /
      // Fork / Add automation… / Open in new window'.
      const CHAT_ACTION_LABELS = new Set([
        'Pin chat', 'Unpin chat', 'Rename chat', 'Archive chat',
        'Open side chat', 'Copy', 'Fork', 'Add automation…', 'Open in new window',
      ]);
      const modelItems = items.filter((it) => {
        const t = leadingText(it).replace(/[⌥⌘⌃⇧⏎].*$/, '').trim();
        return t && !CHAT_ACTION_LABELS.has(t);
      });

      const labels = modelItems.map(leadingText);
      const target = ${namejson};
      if (!target) {
        document.body.click();
        return { ok: true, labels };
      }
      const idx = labels.findIndex((l) => l.toLowerCase().includes(target));
      if (idx < 0) {
        document.body.click();
        return { ok: false, reason: 'No model matched.', detail: 'wanted=' + target + ' available=' + JSON.stringify(labels) };
      }
      const chosen = modelItems[idx];
      const chosenLabel = labels[idx];

      const cr = chosen.getBoundingClientRect();
      const cinit = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(cr.left + cr.width / 2),
        clientY: Math.round(cr.top + cr.height / 2),
      };
      Promise.resolve().then(() => {
        try {
          chosen.dispatchEvent(new PointerEvent('pointerdown', { ...cinit, pointerType: 'mouse' }));
          chosen.dispatchEvent(new MouseEvent('mousedown', cinit));
          chosen.dispatchEvent(new PointerEvent('pointerup', { ...cinit, pointerType: 'mouse' }));
          chosen.dispatchEvent(new MouseEvent('mouseup', cinit));
          chosen.dispatchEvent(new MouseEvent('click', cinit));
        } catch {}
      });
      return { ok: true, switched: true, chosen: chosenLabel, labels };
    })()`);

        if (!result.ok) {
            throw new CommandExecutionError(result.reason, result.detail || '');
        }
        if (listOnly) {
            return result.labels.map((m) => ({ Status: m === current ? 'Active' : 'Available', Model: m }));
        }
        return [{ Status: 'switched', Model: result.chosen }];
    },
});
