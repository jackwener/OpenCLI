import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  findNotebooklmSourceRow,
  getNotebooklmPageState,
  listNotebooklmSourcesFromPage,
  listNotebooklmSourcesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source-get',
  description: 'Get one source from the currently opened NotebookLM notebook by id or title',
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
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-get',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rpcRows = await listNotebooklmSourcesViaRpc(page).catch(() => []);
    const rows = rpcRows.length > 0 ? rpcRows : await listNotebooklmSourcesFromPage(page);
    if (rows.length === 0) {
      throw new EmptyResultError(
        'opencli notebooklm source-get',
        'No NotebookLM sources were found on the current page.',
      );
    }

    const query = typeof kwargs.source === 'string' ? kwargs.source : String(kwargs.source ?? '');
    const matched = findNotebooklmSourceRow(rows, query);
    if (matched) return [matched];

    throw new EmptyResultError(
      'opencli notebooklm source-get',
      `Source "${query}" was not found in the current notebook.`,
    );
  },
});
