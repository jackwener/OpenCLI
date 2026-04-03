import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  getNotebooklmPageState,
  getNotebooklmSummaryViaRpc,
  readNotebooklmSummaryFromPage,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'summary',
  description: 'Get the summary block from the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['title', 'summary', 'source', 'url'],
  func: async (page: IPage) => {
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm summary',
        'No NotebookLM notebook is open in the automation workspace. Run `opencli notebooklm open <notebook>` first.',
      );
    }

    const domSummary = await readNotebooklmSummaryFromPage(page);
    if (domSummary) return [domSummary];

    const rpcSummary = await getNotebooklmSummaryViaRpc(page).catch(() => null);
    if (rpcSummary) return [rpcSummary];

    throw new EmptyResultError(
      'opencli notebooklm summary',
      'NotebookLM summary was not found on the current page.',
    );
  },
});
