import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  completeNotebooklmArtifactIds,
  downloadNotebooklmAudioViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'download/audio',
  aliases: ['download-audio'],
  description: 'Download one completed NotebookLM audio artifact',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'output_path',
      positional: true,
      required: true,
      help: 'Audio file path to write',
    },
    {
      name: 'artifact-id',
      help: 'Specific completed audio artifact id',
      completion: () => completeNotebooklmArtifactIds('audio'),
    },
  ],
  columns: ['artifact_id', 'artifact_type', 'mime_type', 'created_at', 'output_path', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm download audio',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const outputPath = typeof kwargs.output_path === 'string'
      ? kwargs.output_path.trim()
      : String(kwargs.output_path ?? '').trim();
    if (!outputPath) {
      throw new ArgumentError('The audio output path cannot be empty.');
    }

    const artifactId = typeof kwargs['artifact-id'] === 'string'
      ? kwargs['artifact-id'].trim()
      : '';
    const downloaded = await downloadNotebooklmAudioViaRpc(page, outputPath, artifactId || undefined);
    if (downloaded) return [downloaded];

    throw new EmptyResultError(
      'opencli notebooklm download audio',
      artifactId
        ? `Completed audio artifact "${artifactId}" was not found in the current notebook.`
        : 'No completed audio artifacts were found in the current notebook.',
    );
  },
});
