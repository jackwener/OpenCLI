import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmSourcesFromPage,
  listNotebooklmSourcesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source-list',
  description: 'List sources for the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-list',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rpcRows = await listNotebooklmSourcesViaRpc(page).catch(() => []);
    if (rpcRows.length > 0) return rpcRows;

    const domRows = await listNotebooklmSourcesFromPage(page);
    if (domRows.length > 0) return domRows;

    throw new EmptyResultError(
      'opencli notebooklm source-list',
      'No NotebookLM sources were found on the current page.',
    );
  },
});
