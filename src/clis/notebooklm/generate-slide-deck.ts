import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  generateNotebooklmSlideDeckViaRpc,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'generate/slide-deck',
  aliases: ['generate-slide-deck'],
  description: 'Generate one NotebookLM slide deck artifact in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'wait',
      type: 'bool',
      default: false,
      help: 'Wait for the generated slide deck artifact to become visible and ready',
    },
  ],
  columns: ['artifact_type', 'status', 'artifact_id', 'created_at', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm generate slide-deck',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const generated = await generateNotebooklmSlideDeckViaRpc(page, {
      wait: Boolean(kwargs.wait),
    });
    if (generated) return [generated];

    throw new EmptyResultError(
      'opencli notebooklm generate slide-deck',
      'NotebookLM did not accept a slide-deck generation request for the current notebook.',
    );
  },
});
