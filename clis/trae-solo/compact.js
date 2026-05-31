import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

// .solo-mobile-compact-btn at the bottom-left toggles mobile-compact view.

cli({
    site: 'trae-solo',
    name: 'compact',
    access: 'write',
    description: 'Toggle the mobile-compact view (bottom-left .solo-mobile-compact-btn).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = document.querySelector('.solo-mobile-compact-btn');
      if (!btn) return { ok: false, reason: '.solo-mobile-compact-btn not found.' };
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
      await wait(400);
      return { ok: true };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Compact toggle failed.', '');
        }
        return [{ Status: 'toggled' }];
    },
});
