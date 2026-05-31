import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

async function readCurrentModel(page) {
    const current = await page.evaluate(`(function() {
      const trigger = document.querySelector('.core-model-select-trigger');
      return trigger ? (trigger.textContent || '').trim() : '';
    })()`);
    return typeof current === 'string' ? current.trim() : '';
}

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
        const current = await readCurrentModel(page);
        if (!current) {
            throw selectorError('TRAE SOLO model trigger (.core-model-select-trigger). Make sure a chat task is open (not the project-list view).');
        }

        // List or switch — both require opening the menu
        if (listOnly || name) {
            const namejson = JSON.stringify(name);

            // Stage 1 (eval): open the trigger + enumerate option labels.
            const stage1 = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const trigger = document.querySelector('.core-model-select-trigger');
        if (!trigger) return { ok: false, reason: 'model trigger gone' };
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

        let opts = [];
        for (let attempt = 0; attempt < 16; attempt += 1) {
          await wait(80);
          opts = Array.from(document.querySelectorAll('.core-model-select-model-item[role="option"]'))
            .filter((el) => el instanceof HTMLElement && el.offsetParent);
          if (opts.length) break;
        }
        if (!opts.length) {
          return { ok: false, reason: 'Model menu did not open.' };
        }
        const labels = opts.map((o) => {
          const nameEl = o.querySelector('.core-model-select-model-item-name');
          return ((nameEl ? nameEl.textContent : o.textContent) || '').trim();
        });
        return { ok: true, labels };
      })()`);

            if (!stage1.ok) {
                throw new CommandExecutionError(stage1.reason, stage1.detail || '');
            }

            if (listOnly) {
                try { await page.evaluate('document.body.click()'); } catch {}
                return stage1.labels.map((m) => ({ Status: m === current ? 'Active' : 'Available', Model: m }));
            }

            // Stage 2 (page.click): use real CDP Input.dispatchMouseEvent —
            // Trae's model menu items don't fire React onSelect from synthetic
            // pointer events alone. Match by nth-of-type derived from labels.
            const idx = stage1.labels.findIndex((l) => l.toLowerCase().includes(name));
            if (idx < 0) {
                try { await page.evaluate('document.body.click()'); } catch {}
                throw new CommandExecutionError(
                    `No model matched: '${name}'`,
                    'available=' + JSON.stringify(stage1.labels),
                );
            }
            const chosenLabel = stage1.labels[idx];
            const clickSelector = `.core-model-select-model-item[role="option"]:nth-of-type(${idx + 1})`;
            try {
                await page.click(clickSelector);
            } catch (err) {
                // Some Trae model rows wrap option in another element; fall back
                // to JS dispatch on the nth visible option.
                const fallbackClicked = await page.evaluate(`(function(i) {
          const opts = Array.from(document.querySelectorAll('.core-model-select-model-item[role="option"]'))
            .filter((el) => el.offsetParent);
          const target = opts[i];
          if (!target) return false;
          const r = target.getBoundingClientRect();
          const init = { bubbles: true, cancelable: true, button: 0, buttons: 1,
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.top + r.height / 2) };
          target.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mousedown', init));
          target.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mouseup', init));
          target.dispatchEvent(new MouseEvent('click', init));
          return true;
        })(${idx})`);
                if (!fallbackClicked) {
                    throw new CommandExecutionError('Click on model option failed.', `model=${chosenLabel}`);
                }
            }
            await page.wait(0.6);
            const after = await readCurrentModel(page);
            if (!after || !after.toLowerCase().includes(name)) {
                throw new CommandExecutionError(
                    `Model click did not verify selected model "${chosenLabel}".`,
                    after ? `current=${after}` : 'model trigger was unreadable after click',
                );
            }
            return [{ Status: 'switched', Model: after }];
        }

        // Just read the current.
        return [{ Status: 'Active', Model: current }];
    },
});
