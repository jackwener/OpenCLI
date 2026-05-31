import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

// When viewing a task chat, a 'Back to Project List' button is at
// .index-module__collapseButton___cvls. Clicking returns to the
// project-list sidebar view.

cli({
    site: 'trae-solo',
    name: 'back',
    access: 'write',
    description: 'In the chat view, return to the project task list (collapse back).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = document.querySelector('[class*="collapseButton"]');
      if (!btn) return { ok: false, reason: 'No "back" button visible — already on the project list?' };
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
      await wait(500);
      return { ok: true };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Back navigation failed.', '');
        }
        return [{ Status: 'back' }];
    },
});
