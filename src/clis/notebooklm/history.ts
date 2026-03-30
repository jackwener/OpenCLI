import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmHistoryViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'history',
  description: 'List NotebookLM conversation history threads in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['thread_id', 'item_count', 'preview', 'source', 'notebook_id', 'url'],
  func: async (page: IPage) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm history',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rows = await listNotebooklmHistoryViaRpc(page);
    return rows;
  },
});
