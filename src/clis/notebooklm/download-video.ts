import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  completeNotebooklmArtifactIds,
  downloadNotebooklmVideoViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'download/video',
  aliases: ['download-video'],
  description: 'Download one completed NotebookLM video artifact',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'output_path',
      positional: true,
      required: true,
      help: 'Video file path to write',
    },
    {
      name: 'artifact-id',
      help: 'Specific completed video artifact id',
      completion: () => completeNotebooklmArtifactIds('video'),
    },
  ],
  columns: ['artifact_id', 'artifact_type', 'mime_type', 'created_at', 'output_path', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm download video',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const outputPath = typeof kwargs.output_path === 'string'
      ? kwargs.output_path.trim()
      : String(kwargs.output_path ?? '').trim();
    if (!outputPath) {
      throw new ArgumentError('The video output path cannot be empty.');
    }

    const artifactId = typeof kwargs['artifact-id'] === 'string'
      ? kwargs['artifact-id'].trim()
      : '';
    const downloaded = await downloadNotebooklmVideoViaRpc(page, outputPath, artifactId || undefined);
    if (downloaded) return [downloaded];

    throw new EmptyResultError(
      'opencli notebooklm download video',
      artifactId
        ? `Completed video artifact "${artifactId}" was not found in the current notebook.`
        : 'No completed video artifacts were found in the current notebook.',
    );
  },
});
