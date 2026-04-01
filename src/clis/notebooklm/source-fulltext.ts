import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  findNotebooklmSourceRow,
  getNotebooklmPageState,
  getNotebooklmSourceFulltextViaRpc,
  listNotebooklmSourcesFromPage,
  listNotebooklmSourcesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/fulltext',
  aliases: ['source-fulltext'],
  description: 'Get the extracted fulltext for one source in the currently opened NotebookLM notebook',
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
  columns: ['title', 'kind', 'char_count', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-fulltext',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rpcRows = await listNotebooklmSourcesViaRpc(page).catch(() => []);
    const rows = rpcRows.length > 0 ? rpcRows : await listNotebooklmSourcesFromPage(page);
    if (rows.length === 0) {
      throw new EmptyResultError(
        'opencli notebooklm source-fulltext',
        'No NotebookLM sources were found on the current page.',
      );
    }

    const query = typeof kwargs.source === 'string' ? kwargs.source : String(kwargs.source ?? '');
    const matched = findNotebooklmSourceRow(rows, query);
    if (!matched) {
      throw new EmptyResultError(
        'opencli notebooklm source-fulltext',
        `Source "${query}" was not found in the current notebook.`,
      );
    }

    const fulltext = await getNotebooklmSourceFulltextViaRpc(page, matched.id).catch(() => null);
    if (fulltext) return [fulltext];

    throw new EmptyResultError(
      'opencli notebooklm source-fulltext',
      `NotebookLM fulltext was not available for source "${matched.title}".`,
    );
  },
});
