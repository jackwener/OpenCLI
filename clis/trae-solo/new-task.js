import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
    site: 'trae-solo',
    name: 'new-task',
    access: 'write',
    description: 'Create a new task in a Trae SOLO project. Clicks the "New task" button in the project header.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', positional: true, required: true, help: 'Project name (substring match, case-insensitive)' },
    ],
    columns: ['status', 'project'],
    func: async (page, kwargs) => {
        const filter = String(kwargs.project || '').trim().toLowerCase();
        const fjson = JSON.stringify(filter);

        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const filter = ${fjson};
      const groups = Array.from(document.querySelectorAll('.task-list-group')).filter((g) => g.offsetParent);
      for (const group of groups) {
        const header = group.querySelector('.task-list-group-header-wrapper');
        if (!header) continue;
        const headerText = ((header.innerText || '').split('\\n')[0] || '').trim().toLowerCase();
        if (filter && !headerText.includes(filter)) continue;
        const newBtn = header.querySelector('button[aria-label="New task"], .task-list-group-new-btn');
        if (!newBtn) continue;
        const rect = newBtn.getBoundingClientRect();
        const init = {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
        newBtn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
        newBtn.dispatchEvent(new MouseEvent('mousedown', init));
        newBtn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
        newBtn.dispatchEvent(new MouseEvent('mouseup', init));
        newBtn.dispatchEvent(new MouseEvent('click', init));
        await wait(500);
        return { ok: true, project: headerText };
      }
      return { ok: false, reason: 'No matching project found.', detail: 'filter=' + filter };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'New task failed.', result?.detail || '');
        }
        return [{ status: 'created', project: result.project || '' }];
    },
});
