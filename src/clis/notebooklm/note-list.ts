import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmNotesFromPage,
  listNotebooklmNotesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes/list',
  aliases: ['note-list', 'notes-list'],
  description: 'List saved notes from the Studio panel of the current NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['title', 'id', 'created_at', 'source', 'url'],
  func: async (page: IPage) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm note-list',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rows = await listNotebooklmNotesFromPage(page);
    if (rows.length > 0) return rows;

    const rpcRows = await listNotebooklmNotesViaRpc(page);
    if (rpcRows.length > 0) return rpcRows;

    throw new EmptyResultError(
      'opencli notebooklm note-list',
      'No NotebookLM notes were available from the Studio panel or the notebook notes RPC. Open a specific notebook tab and retry.',
    );
  },
});
