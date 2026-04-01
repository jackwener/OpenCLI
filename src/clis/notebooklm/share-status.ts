import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  getNotebooklmShareStatusViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'share-status',
  description: 'Get sharing status for the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['access', 'is_public', 'shared_user_count', 'share_url', 'source'],
  func: async (page: IPage) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm share-status',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const status = await getNotebooklmShareStatusViaRpc(page);
    if (status) return [status];

    throw new EmptyResultError(
      'opencli notebooklm share-status',
      'NotebookLM share status was not available for the current notebook.',
    );
  },
});
