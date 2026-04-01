import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  NOTEBOOKLM_DOMAIN,
  NOTEBOOKLM_SITE,
  type NotebooklmInfographicDetail,
  type NotebooklmInfographicOrientation,
  type NotebooklmInfographicStyle,
} from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  generateNotebooklmInfographicViaRpc,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

function normalizeOrientation(value: unknown): NotebooklmInfographicOrientation | null {
  return value === 'portrait' || value === 'square' || value === 'landscape'
    ? value
    : null;
}

function normalizeDetail(value: unknown): NotebooklmInfographicDetail | null {
  return value === 'concise' || value === 'standard' || value === 'detailed'
    ? value
    : null;
}

function normalizeStyle(value: unknown): NotebooklmInfographicStyle | null {
  switch (value) {
    case 'auto_select':
    case 'sketch_note':
    case 'professional':
    case 'bento_grid':
    case 'editorial':
    case 'instructional':
    case 'bricks':
    case 'clay':
    case 'anime':
    case 'kawaii':
    case 'scientific':
      return value;
    default:
      return null;
  }
}

cli({
  site: NOTEBOOKLM_SITE,
  name: 'generate/infographic',
  aliases: ['generate-infographic'],
  description: 'Generate one NotebookLM infographic artifact in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'instructions',
      help: 'Optional custom infographic instructions',
    },
    {
      name: 'orientation',
      choices: ['landscape', 'portrait', 'square'],
      help: 'Infographic orientation',
    },
    {
      name: 'detail',
      choices: ['concise', 'standard', 'detailed'],
      help: 'Infographic detail level',
    },
    {
      name: 'style',
      choices: [
        'auto_select',
        'sketch_note',
        'professional',
        'bento_grid',
        'editorial',
        'instructional',
        'bricks',
        'clay',
        'anime',
        'kawaii',
        'scientific',
      ],
      help: 'Infographic visual style',
    },
    {
      name: 'wait',
      type: 'bool',
      default: false,
      help: 'Wait for the generated infographic artifact to become visible and ready',
    },
  ],
  columns: ['artifact_type', 'status', 'artifact_id', 'created_at', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm generate infographic',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const generated = await generateNotebooklmInfographicViaRpc(page, {
      instructions: typeof kwargs.instructions === 'string' ? kwargs.instructions : null,
      orientation: normalizeOrientation(kwargs.orientation),
      detail: normalizeDetail(kwargs.detail),
      style: normalizeStyle(kwargs.style),
      wait: Boolean(kwargs.wait),
    });
    if (generated) return [generated];

    throw new EmptyResultError(
      'opencli notebooklm generate infographic',
      'NotebookLM did not accept an infographic generation request for the current notebook.',
    );
  },
});
