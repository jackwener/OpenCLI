import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmSourcesViaRpc,
  renameNotebooklmSourceViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/rename',
  aliases: ['source-rename'],
  description: 'Rename a source in the current NotebookLM notebook via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'New title for the source',
    },
    {
      name: 'source',
      help: 'Existing source title when not using --source-id',
    },
    {
      name: 'source-id',
      help: 'Stable source id from notebooklm source list',
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-rename',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : '';
    if (!title) throw new ArgumentError('Provide the new source title.');

    const explicitId = typeof kwargs['source-id'] === 'string' ? kwargs['source-id'].trim() : '';
    let sourceId = explicitId;

    if (!sourceId) {
      const query = typeof kwargs.source === 'string' ? kwargs.source.trim() : '';
      if (!query) throw new ArgumentError('Provide either a source title or --source-id.');

      const rows = await listNotebooklmSourcesViaRpc(page);
      const matches = rows.filter((row) => row.title.trim().toLowerCase() === query.toLowerCase());
      if (matches.length === 0) {
        throw new CliError(
          'NOTEBOOKLM_SOURCE_NOT_FOUND',
          `NotebookLM source "${query}" was not found in the current notebook.`,
          `No NotebookLM source titled "${query}" was found in the current notebook.`,
        );
      }
      if (matches.length > 1) {
        throw new CliError(
          'NOTEBOOKLM_SOURCE_AMBIGUOUS',
          `NotebookLM found multiple sources titled "${query}"`,
          'Use --source-id with notebooklm source rename when duplicate source titles exist.',
        );
      }
      sourceId = matches[0]!.id;
    }

    const renamed = await renameNotebooklmSourceViaRpc(page, sourceId, title);
    if (!renamed) {
      throw new CliError(
        'NOTEBOOKLM_SOURCE_ID_NOT_FOUND',
        `NotebookLM source id "${sourceId}" was not found in the current notebook.`,
        `No NotebookLM source with id "${sourceId}" was found in the current notebook.`,
      );
    }

    return [renamed];
  },
});
