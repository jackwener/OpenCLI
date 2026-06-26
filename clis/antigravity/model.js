import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './_actions.js';

// Antigravity exposes the active model via the composer button whose
// aria-label looks like:
//   "Select model, current: Gemini 3.5 Flash (Medium)"
// We parse the current model from that aria-label, and switch by clicking
// the button to open the model picker dialog, then matching by visible
// text inside the dialog.

cli({
    site: 'antigravity',
    name: 'model',
    access: 'write',
    description: 'Read or switch the active model in Antigravity. Without arguments, reports the current model. With <name> (substring, case-insensitive), switches.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', required: false, positional: true, help: 'Substring (case-insensitive) of target model name. Omit to read current.' },
        { name: 'list', type: 'boolean', default: false, help: 'List models in the picker (does not switch)' },
    ],
    columns: ['Status', 'Model'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        const listOnly = kwargs.list === true || kwargs.list === 'true';
        const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

        // Read current model from button's aria-label.
        const current = unwrapEvaluateResult(await page.evaluate(`(function() {
      const btn = document.querySelector('button[aria-label^="Select model, current:"]');
      if (!btn) return '';
      const aria = btn.getAttribute('aria-label') || '';
      const m = aria.match(/current:\\s*(.*)$/i);
      return m ? m[1].trim() : (btn.textContent || '').trim();
    })()`));
        if (!current) {
            throw selectorError('Antigravity model button (button[aria-label^="Select model, current:"]). Make sure a chat is open in the foreground.');
        }

        if (!name && !listOnly) {
            return [{ Status: 'Active', Model: current }];
        }

        const namejson = JSON.stringify(name);
        const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const trigger = document.querySelector('button[aria-label^="Select model, current:"]');
      if (!trigger) return { ok: false, reason: 'trigger missing' };

      // Open the picker dialog (full pointer chain — radix uses pointer events).
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

      // Wait for the picker dialog to open. Antigravity renders it as a
      // [role="dialog"] or a div with selectable rows (cursor-pointer).
      let rows = [];
      for (let attempt = 0; attempt < 18; attempt += 1) {
        await wait(80);
        rows = Array.from(document.querySelectorAll('[role="dialog"] .cursor-pointer, [role="dialog"] [role="option"], [role="dialog"] li, .cursor-pointer'))
          .filter((el) => el instanceof HTMLElement && el.offsetParent);
        // Filter out rows clearly outside the dialog (e.g. global cursor-pointer in sidebar)
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          rows = rows.filter((r) => dialog.contains(r));
        }
        if (rows.length) break;
      }
      if (!rows.length) {
        return { ok: false, reason: 'Model picker dialog did not surface any rows.' };
      }

      const labels = rows.map((r) => (r.innerText || r.textContent || '').trim().slice(0, 80));
      const target = ${namejson};
      const listOnly = ${listOnly ? 'true' : 'false'};
      if (!target || listOnly) {
        // Close picker (Esc) and return list.
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        return { ok: true, labels };
      }
      const exactMatches = labels
        .map((label, index) => ({ label, index }))
        .filter((entry) => entry.label.toLowerCase() === target);
      const matches = exactMatches.length ? exactMatches : labels
        .map((label, index) => ({ label, index }))
        .filter((entry) => entry.label.toLowerCase().includes(target));
      if (!matches.length) {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        return { ok: false, reason: 'No model matched.', detail: 'wanted=' + target + ' visible=' + JSON.stringify(labels) };
      }
      if (matches.length > 1) {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        return { ok: false, reason: 'Ambiguous model match.', detail: 'wanted=' + target + ' matches=' + JSON.stringify(matches.map((m) => m.label)) };
      }
      const chosen = rows[matches[0].index];
      const chosenLabel = matches[0].label;

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
    })()`));

        if (!result.ok) {
            if (result.reason === 'Ambiguous model match.') {
                throw new ArgumentError(result.detail || 'Ambiguous model match.');
            }
            throw new CommandExecutionError(result.reason, result.detail || '');
        }
        if (listOnly) {
            return result.labels.map((m) => ({ Status: m.startsWith(current.slice(0, 20)) ? 'Active' : 'Available', Model: m }));
        }
        await page.wait(0.8);
        let verified = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
            verified = unwrapEvaluateResult(await page.evaluate(`(function() {
        const btn = document.querySelector('button[aria-label^="Select model, current:"]');
        if (!btn) return '';
        const aria = btn.getAttribute('aria-label') || '';
        const m = aria.match(/current:\\s*(.*)$/i);
        return m ? m[1].trim() : (btn.textContent || '').trim();
      })()`));
            if (
                normalize(verified)
                && (normalize(result.chosen).includes(normalize(verified)) || normalize(verified).includes(normalize(result.chosen)))
            ) {
                return [{ Status: 'switched', Model: verified }];
            }
            if (normalize(verified) === normalize(result.chosen)) {
                return [{ Status: 'switched', Model: verified }];
            }
            await page.wait(0.4);
        }
        throw new CommandExecutionError(
            `Could not verify Antigravity model switched to ${result.chosen}.`,
            `Read back current model: ${verified || '(empty)'}`,
        );
    },
});
