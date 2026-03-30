import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmHome,
  listNotebooklmLinks,
  listNotebooklmViaRpc,
  readCurrentNotebooklm,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'list',
  description: 'List NotebookLM notebooks via in-page batchexecute RPC in the current logged-in session',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['title', 'id', 'is_owner', 'created_at', 'source', 'url'],
  func: async (page: IPage) => {
    const currentFallback = await readCurrentNotebooklm(page).catch(() => null);
    await ensureNotebooklmHome(page);
    await requireNotebooklmSession(page);

    try {
      const rpcRows = await listNotebooklmViaRpc(page);
      if (rpcRows.length > 0) return rpcRows;
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
    }

    const domRows = await listNotebooklmLinks(page);
    if (domRows.length > 0) return domRows;
    if (currentFallback) return [currentFallback];
    return [];
  },
});
