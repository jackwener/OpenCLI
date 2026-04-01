import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE, type NotebooklmSlideDeckDownloadFormat } from './shared.js';
import {
  completeNotebooklmArtifactIds,
  downloadNotebooklmSlideDeckViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

function normalizeSlideDeckFormat(value: unknown): NotebooklmSlideDeckDownloadFormat {
  return value === 'pptx' ? 'pptx' : 'pdf';
}

cli({
  site: NOTEBOOKLM_SITE,
  name: 'download/slide-deck',
  aliases: ['download-slide-deck'],
  description: 'Download one completed NotebookLM slide deck artifact as pdf or pptx',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'output_path',
      positional: true,
      required: true,
      help: 'Slide deck file path to write',
    },
    {
      name: 'artifact-id',
      help: 'Specific completed slide deck artifact id',
      completion: () => completeNotebooklmArtifactIds('slide_deck'),
    },
    {
      name: 'output-format',
      default: 'pdf',
      choices: ['pdf', 'pptx'],
      help: 'Download format',
    },
  ],
  columns: ['artifact_id', 'artifact_type', 'download_format', 'created_at', 'output_path', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm download slide-deck',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const outputPath = typeof kwargs.output_path === 'string'
      ? kwargs.output_path.trim()
      : String(kwargs.output_path ?? '').trim();
    if (!outputPath) {
      throw new ArgumentError('The slide-deck output path cannot be empty.');
    }

    const artifactId = typeof kwargs['artifact-id'] === 'string'
      ? kwargs['artifact-id'].trim()
      : '';
    const outputFormat = normalizeSlideDeckFormat(kwargs['output-format']);
    const downloaded = await downloadNotebooklmSlideDeckViaRpc(
      page,
      outputPath,
      artifactId || undefined,
      outputFormat,
    );
    if (downloaded) return [downloaded];

    throw new EmptyResultError(
      'opencli notebooklm download slide-deck',
      artifactId
        ? `Completed slide-deck artifact "${artifactId}" with format "${outputFormat}" was not found in the current notebook.`
        : `No completed slide-deck artifacts with format "${outputFormat}" were found in the current notebook.`,
    );
  },
});
