import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

cli({
    site: 'trae-solo',
    name: 'model',
    access: 'write',
    description: 'Read or switch the current AI model in TRAE SOLO. Without arguments, reports the current model. With <name> argument (substring, case-insensitive), switches to a matching model. Pass --list to enumerate available models.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', required: false, positional: true, help: 'Target model name (substring match, case-insensitive). Omit to read current.' },
        { name: 'list', type: 'boolean', default: false, help: 'List all available models (does not switch)' },
    ],
    columns: ['Status', 'Model'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim().toLowerCase();
        const listOnly = kwargs.list === true || kwargs.list === 'true';

        // Read current model from the composer trigger
        const current = await page.evaluate(`(function() {
      const trigger = document.querySelector('.core-model-select-trigger');
      return trigger ? (trigger.textContent || '').trim() : '';
    })()`);
        if (!current) {
            throw selectorError('TRAE SOLO model trigger (.core-model-select-trigger). Make sure a chat task is open (not the project-list view).');
        }

        // List or switch — both require opening the menu
        if (listOnly || name) {
            const namejson = JSON.stringify(name);
            const result = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const trigger = document.querySelector('.core-model-select-trigger');
        if (!trigger) return { ok: false, reason: 'model trigger gone' };

        // Open menu via full pointer chain.
        const r = trigger.getBoundingClientRect();
        const init = {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
          clientX: Math.round(r.left + Math.min(r.width / 2, 20)),
          clientY: Math.round(r.top + Math.min(r.height / 2, 10)),
        };
        trigger.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
        trigger.dispatchEvent(new MouseEvent('mousedown', init));
        trigger.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
        trigger.dispatchEvent(new MouseEvent('mouseup', init));
        trigger.dispatchEvent(new MouseEvent('click', init));

        // Wait for menu items to mount.
        let opts = [];
        for (let attempt = 0; attempt < 16; attempt += 1) {
          await wait(80);
          opts = Array.from(document.querySelectorAll('.core-model-select-model-item[role="option"]'))
            .filter((el) => el instanceof HTMLElement && el.offsetParent);
          if (opts.length) break;
        }
        if (!opts.length) {
          return { ok: false, reason: 'Model menu did not open (no .core-model-select-model-item[role="option"] visible).' };
        }

        const labels = opts.map((o) => {
          const nameEl = o.querySelector('.core-model-select-model-item-name');
          return ((nameEl ? nameEl.textContent : o.textContent) || '').trim();
        });

        // List-only path — return the labels and close menu.
        const target = ${namejson};
        if (!target) {
          document.body.click();
          return { ok: true, labels };
        }

        // Switch path — pick the first label that contains the target substring.
        const idx = labels.findIndex((l) => l.toLowerCase().includes(target));
        if (idx < 0) {
          document.body.click();
          return { ok: false, reason: 'No model matched.', detail: 'wanted=' + target + ' available=' + JSON.stringify(labels) };
        }
        const chosen = opts[idx];
        const chosenLabel = labels[idx];

        // Click the chosen option via full pointer chain (radix-style menu items).
        const cr = chosen.getBoundingClientRect();
        const cinit = {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
          clientX: Math.round(cr.left + cr.width / 2),
          clientY: Math.round(cr.top + cr.height / 2),
        };
        // Defer click — menu close + composer re-render can swallow eval reply.
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
        }

        // Just read the current.
        return [{ Status: 'Active', Model: current }];
    },
});
