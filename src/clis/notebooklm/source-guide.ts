import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  findNotebooklmSourceRow,
  getNotebooklmPageState,
  getNotebooklmSourceGuideViaRpc,
  listNotebooklmSourcesFromPage,
  listNotebooklmSourcesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/guide',
  aliases: ['source-guide'],
  description: 'Get the guide summary and keywords for one source in the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'source',
      positional: true,
      required: true,
      help: 'Source id or title from the current notebook',
    },
  ],
  columns: ['source_id', 'notebook_id', 'title', 'type', 'summary', 'keywords', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-guide',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rpcRows = await listNotebooklmSourcesViaRpc(page).catch(() => []);
    const rows = rpcRows.length > 0 ? rpcRows : await listNotebooklmSourcesFromPage(page);
    if (rows.length === 0) {
      throw new EmptyResultError(
        'opencli notebooklm source-guide',
        'No NotebookLM sources were found on the current page.',
      );
    }

    const query = typeof kwargs.source === 'string' ? kwargs.source : String(kwargs.source ?? '');
    const matched = findNotebooklmSourceRow(rows, query);
    if (!matched) {
      throw new EmptyResultError(
        'opencli notebooklm source-guide',
        `Source "${query}" was not found in the current notebook.`,
      );
    }

    const guide = await getNotebooklmSourceGuideViaRpc(page, matched).catch(() => null);
    if (guide) return [guide];

    throw new EmptyResultError(
      'opencli notebooklm source-guide',
      `NotebookLM guide was not available for source "${matched.title}".`,
    );
  },
});
