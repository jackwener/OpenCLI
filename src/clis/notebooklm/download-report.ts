import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  completeNotebooklmArtifactIds,
  downloadNotebooklmReportViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'download/report',
  aliases: ['download-report'],
  description: 'Download one completed NotebookLM report artifact as markdown',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'output_path',
      positional: true,
      required: true,
      help: 'Markdown file path to write',
    },
    {
      name: 'artifact-id',
      help: 'Specific completed report artifact id',
      completion: () => completeNotebooklmArtifactIds('report'),
    },
  ],
  columns: ['title', 'artifact_id', 'created_at', 'output_path', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm download report',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const outputPath = typeof kwargs.output_path === 'string'
      ? kwargs.output_path.trim()
      : String(kwargs.output_path ?? '').trim();
    if (!outputPath) {
      throw new ArgumentError('The report output path cannot be empty.');
    }

    const artifactId = typeof kwargs['artifact-id'] === 'string'
      ? kwargs['artifact-id'].trim()
      : '';
    const downloaded = await downloadNotebooklmReportViaRpc(page, outputPath, artifactId || undefined);
    if (downloaded) return [downloaded];

    throw new EmptyResultError(
      'opencli notebooklm download report',
      artifactId
        ? `Completed report artifact "${artifactId}" was not found in the current notebook.`
        : 'No completed report artifacts were found in the current notebook.',
    );
  },
});
