import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { getNotebooklmPageState, listNotebooklmSourcesFromPage, listNotebooklmSourcesViaRpc, requireNotebooklmSession, } from './utils.js';
cli({
    site: NOTEBOOKLM_SITE,
    name: 'source-list',
    access: 'read',
    description: 'List sources for the currently opened NotebookLM notebook',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
    func: async (page) => {
        await requireNotebooklmSession(page);
        const state = await getNotebooklmPageState(page);
        if (state.kind !== 'notebook') {
            throw new EmptyResultError('opencli notebooklm source-list', 'No NotebookLM notebook is open in the adapter session. Run `opencli notebooklm open <notebook>` first.');
        }
        const rpcRows = await listNotebooklmSourcesViaRpc(page).catch(() => []);
        if (rpcRows.length > 0)
            return rpcRows;
        const domRows = await listNotebooklmSourcesFromPage(page);
        if (domRows.length > 0)
            return domRows;
        throw new EmptyResultError('opencli notebooklm source-list', 'No NotebookLM sources were found on the current page.');
    },
});
