import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { flattenCodexProjects, readCodexProjects } from './sidebar.js';
export const historyCommand = cli({
    site: 'codex',
    name: 'history',
    access: 'read',
    description: 'List visible Codex conversation threads grouped by project',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', required: false, help: 'Filter by project label or path' },
        { name: 'limit', required: false, help: 'Max conversations per project' },
    ],
    columns: ['Project', 'Index', 'Title', 'Updated', 'Active'],
    func: async (page, kwargs) => {
        const projects = await readCodexProjects(page);
        const rows = flattenCodexProjects(projects, kwargs);
        if (rows.length === 0) {
            throw new EmptyResultError('codex history', kwargs.project
                ? `No Codex conversations were visible for project "${kwargs.project}".`
                : 'No Codex conversations were visible. Open the Codex sidebar and retry.');
        }
        return rows;
    },
});
