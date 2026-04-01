import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  checkNotebooklmSourceFreshnessViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmSourcesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/check-freshness',
  aliases: ['source-check-freshness'],
  description: 'Check whether a source is fresh in the current NotebookLM notebook via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'source',
      positional: true,
      required: false,
      help: 'Existing source title when not using --source-id',
    },
    {
      name: 'source-id',
      help: 'Stable source id from notebooklm source list',
    },
  ],
  columns: ['source_id', 'is_fresh', 'is_stale', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-check-freshness',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const explicitId = typeof kwargs['source-id'] === 'string' ? kwargs['source-id'].trim() : '';
    let sourceId = explicitId;
    const rows = await listNotebooklmSourcesViaRpc(page);

    if (sourceId) {
      const matched = rows.find((row) => row.id === sourceId) ?? null;
      if (!matched) {
        throw new CliError(
          'NOTEBOOKLM_SOURCE_ID_NOT_FOUND',
          `NotebookLM source id "${sourceId}" was not found in the current notebook.`,
          `No NotebookLM source with id "${sourceId}" was found in the current notebook.`,
        );
      }
    } else {
      const query = typeof kwargs.source === 'string' ? kwargs.source.trim() : '';
      if (!query) throw new ArgumentError('Provide either a source title or --source-id.');

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
          'Use --source-id with notebooklm source check-freshness when duplicate source titles exist.',
        );
      }
      sourceId = matches[0]!.id;
    }

    const freshness = await checkNotebooklmSourceFreshnessViaRpc(page, sourceId);
    if (!freshness) {
      throw new CliError(
        'NOTEBOOKLM_SOURCE_ID_NOT_FOUND',
        `NotebookLM source id "${sourceId}" was not found in the current notebook.`,
        `No NotebookLM source with id "${sourceId}" was found in the current notebook.`,
      );
    }

    return [freshness];
  },
});
