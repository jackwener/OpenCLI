import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';

cli({
    site: 'trae-solo',
    name: 'history',
    access: 'read',
    description: 'List Trae SOLO projects and the tasks within each (from the project-list view sidebar).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', required: false, help: 'Filter by project name (substring, case-insensitive)' },
        { name: 'limit', type: 'int', required: false, default: 100, help: 'Max tasks per project' },
    ],
    columns: ['Project', 'Task Index', 'Task'],
    func: async (page, kwargs) => {
        const projects = await page.evaluate(`(function() {
      const out = [];
      const groups = Array.from(document.querySelectorAll('.task-list-group')).filter((g) => g.offsetParent);
      for (const group of groups) {
        const headerText = (group.querySelector('.task-list-group-header-wrapper')?.innerText || '').trim().split('\\n')[0] || '';
        const inner = group.querySelector('.task-list-group-collapsible-inner');
        const list = inner ? inner.querySelector('.task-list-group-list') : null;
        const taskRows = list ? Array.from(list.querySelectorAll('.task-list-row-wrapper')).filter((r) => r.offsetParent) : [];
        out.push({
          project: headerText,
          tasks: taskRows.map((row) => (row.innerText || '').trim().split('\\n')[0] || '(untitled)'),
        });
      }
      return out;
    })()`);

        const filter = (kwargs.project || '').toLowerCase();
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        const rows = [];
        for (const p of projects || []) {
            if (filter && !p.project.toLowerCase().includes(filter)) continue;
            const tasks = p.tasks.slice(0, limit);
            for (let i = 0; i < tasks.length; i++) {
                rows.push({ Project: p.project, 'Task Index': i + 1, Task: tasks[i] });
            }
        }
        if (!rows.length) {
            throw new EmptyResultError(
                'trae-solo history',
                filter
                    ? `No projects matched "${kwargs.project}". Try without --project.`
                    : 'No projects visible. Make sure TRAE SOLO is on the project-list view and the sidebar is expanded.',
            );
        }
        return rows;
    },
});
