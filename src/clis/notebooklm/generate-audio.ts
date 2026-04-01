import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  generateNotebooklmAudioViaRpc,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'generate/audio',
  aliases: ['generate-audio'],
  description: 'Generate one NotebookLM audio artifact in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'wait',
      type: 'bool',
      default: false,
      help: 'Wait for the generated audio artifact to become visible and ready',
    },
  ],
  columns: ['artifact_type', 'status', 'artifact_id', 'created_at', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm generate audio',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const generated = await generateNotebooklmAudioViaRpc(page, {
      wait: Boolean(kwargs.wait),
    });
    if (generated) return [generated];

    throw new EmptyResultError(
      'opencli notebooklm generate audio',
      'NotebookLM did not accept an audio generation request for the current notebook.',
    );
  },
});
