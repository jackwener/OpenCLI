import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { ensureNotebooklmHome, listNotebooklmLinks, listNotebooklmViaRpc, readCurrentNotebooklm, requireNotebooklmSession, } from './utils.js';
cli({
    site: NOTEBOOKLM_SITE,
    name: 'list',
    access: 'read',
    description: 'List NotebookLM notebooks via in-page batchexecute RPC in the current logged-in session',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['title', 'id', 'is_owner', 'created_at', 'source', 'url'],
    func: async (page) => {
        const currentFallback = await readCurrentNotebooklm(page).catch(() => null);
        await ensureNotebooklmHome(page);
        await requireNotebooklmSession(page);
        let rpcError = null;
        try {
            const rpcRows = await listNotebooklmViaRpc(page);
            if (rpcRows.length > 0)
                return rpcRows;
        }
        catch (error) {
            if (error instanceof AuthRequiredError)
                throw error;
            rpcError = error;
        }
        let domRows;
        try {
            domRows = await listNotebooklmLinks(page);
        }
        catch (error) {
            if (currentFallback)
                return [currentFallback];
            if (rpcError)
                throw rpcError;
            throw error;
        }
        if (domRows.length > 0)
            return domRows;
        if (currentFallback)
            return [currentFallback];
        if (rpcError)
            throw rpcError;
        throw new EmptyResultError('opencli notebooklm list', 'No NotebookLM notebooks were found after the authenticated RPC and home-page fallback both returned empty.');
    },
});
