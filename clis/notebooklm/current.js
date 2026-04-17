import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { getNotebooklmPageState, readCurrentNotebooklm, requireNotebooklmSession } from './utils.js';
cli({
    site: NOTEBOOKLM_SITE,
    name: 'current',
    description: 'Show metadata for the currently opened NotebookLM notebook tab',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['id', 'title', 'url', 'source'],
    func: async (page) => {
        await requireNotebooklmSession(page);
        const state = await getNotebooklmPageState(page);
        if (state.kind !== 'notebook') {
            throw new EmptyResultError('opencli notebooklm current', 'No NotebookLM notebook is open in the automation workspace. Run `opencli notebooklm open <notebook>` first.');
        }
        const current = await readCurrentNotebooklm(page);
        if (!current) {
            throw new EmptyResultError('opencli notebooklm current', 'NotebookLM notebook metadata was not found on the current page.');
        }
        return [current];
    },
});
