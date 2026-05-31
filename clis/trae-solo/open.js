import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

cli({
    site: 'trae-solo',
    name: 'open',
    access: 'write',
    description: 'Open a Trae SOLO task by its title (substring match) to enter its chat view.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'task', positional: true, required: true, help: 'Task title (substring match, case-insensitive)' },
        { name: 'project', required: false, help: 'Restrict to project (substring match)' },
    ],
    columns: ['status', 'project', 'task'],
    func: async (page, kwargs) => {
        const taskFilter = String(kwargs.task || '').trim().toLowerCase();
        if (!taskFilter) throw new ArgumentError('task title cannot be empty');
        const projectFilter = String(kwargs.project || '').trim().toLowerCase();

        const tjson = JSON.stringify(taskFilter);
        const pjson = JSON.stringify(projectFilter);

        const result = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const taskFilter = ${tjson};
      const projectFilter = ${pjson};

      const groups = Array.from(document.querySelectorAll('.task-list-group')).filter((g) => g.offsetParent);
      for (const group of groups) {
        const headerText = ((group.querySelector('.task-list-group-header-wrapper')?.innerText || '').split('\\n')[0] || '').trim().toLowerCase();
        if (projectFilter && !headerText.includes(projectFilter)) continue;
        const list = group.querySelector('.task-list-group-list');
        if (!list) continue;
        const rows = Array.from(list.querySelectorAll('.task-list-row-wrapper')).filter((r) => r.offsetParent);
        for (const row of rows) {
          const title = ((row.innerText || '').split('\\n')[0] || '').trim();
          if (!title.toLowerCase().includes(taskFilter)) continue;
          row.scrollIntoView({ block: 'center' });
          await wait(150);
          const rect = row.getBoundingClientRect();
          const init = {
            bubbles: true, cancelable: true, button: 0, buttons: 1,
            clientX: Math.round(rect.left + Math.min(50, rect.width / 2)),
            clientY: Math.round(rect.top + Math.min(10, rect.height / 2)),
          };
          row.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
          row.dispatchEvent(new MouseEvent('mousedown', init));
          row.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
          row.dispatchEvent(new MouseEvent('mouseup', init));
          row.dispatchEvent(new MouseEvent('click', init));
          await wait(800);
          return { ok: true, project: headerText, task: title };
        }
      }
      return { ok: false, reason: 'No matching task found.', detail: 'task=' + taskFilter + ' project=' + projectFilter };
    })()`);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Open failed.', result?.detail || '');
        }
        return [{ status: 'opened', project: result.project || '', task: result.task || '' }];
    },
});
