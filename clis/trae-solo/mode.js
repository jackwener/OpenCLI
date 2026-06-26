import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

// TRAE SOLO has two top-level modes: "Code" and "Work". The mode indicator
// is a capsule at the top-left (.index-module__capsule___...) whose
// aria-label is "Switch to Work mode" when on Code, and "Switch to Code
// mode" when on Work. Clicking it toggles between the two.

cli({
    site: 'trae-solo',
    name: 'mode',
    access: 'write',
    description: 'Read or switch TRAE SOLO between Code mode and Work mode.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: false, help: 'Target mode: code or work. Omit to read current.' },
    ],
    columns: ['Status', 'Mode'],
    func: async (page, kwargs) => {
        const want = String(kwargs.target || '').trim().toLowerCase();
        if (want && !['code', 'work'].includes(want)) {
            throw new ArgumentError('target must be "code" or "work"');
        }

        const current = await page.evaluate(`(function() {
      const cap = document.querySelector('[class*="capsule"]');
      if (!cap) return '';
      const aria = cap.getAttribute('aria-label') || '';
      // aria says "Switch to <Other> mode" — current is the OTHER one.
      const m = aria.match(/Switch to (Code|Work) mode/i);
      if (m) return m[1].toLowerCase() === 'work' ? 'code' : 'work';
      return '';
    })()`);
        if (!current) {
            throw selectorError('TRAE SOLO mode capsule (.index-module__capsule__ ...).');
        }

        if (!want) {
            return [{ Status: 'Active', Mode: current }];
        }
        if (current === want) {
            return [{ Status: 'no-op (already in target mode)', Mode: current }];
        }

        await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const cap = document.querySelector('[class*="capsule"]');
      if (!cap) return;
      const r = cap.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      cap.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      cap.dispatchEvent(new MouseEvent('mousedown', init));
      cap.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      cap.dispatchEvent(new MouseEvent('mouseup', init));
      cap.dispatchEvent(new MouseEvent('click', init));
      await wait(500);
    })()`);
        await page.wait(0.4);

        const after = await page.evaluate(`(function() {
      const cap = document.querySelector('[class*="capsule"]');
      if (!cap) return '';
      const aria = cap.getAttribute('aria-label') || '';
      const m = aria.match(/Switch to (Code|Work) mode/i);
      return m ? (m[1].toLowerCase() === 'work' ? 'code' : 'work') : '';
    })()`);
        if (after !== want) {
            throw new CommandExecutionError(
                `Mode toggle did not reach requested state "${want}".`,
                after ? `current=${after}` : 'Mode capsule state could not be read after click.',
            );
        }
        return [{ Status: 'switched', Mode: after }];
    },
});
