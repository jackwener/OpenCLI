import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmDownloadArtifactsViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'download/list',
  aliases: ['download-list'],
  description: 'List currently downloadable NotebookLM artifacts in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['artifact_type', 'status', 'title', 'download_variants', 'created_at', 'artifact_id', 'source'],
  func: async (page: IPage) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm download list',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rows = await listNotebooklmDownloadArtifactsViaRpc(page);
    if (rows.length > 0) return rows;

    throw new EmptyResultError(
      'opencli notebooklm download list',
      'No supported downloadable NotebookLM artifacts were found in the current notebook.',
    );
  },
});
