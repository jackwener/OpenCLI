import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  askNotebooklmQuestionViaQuery,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'ask',
  description: 'Ask the current NotebookLM notebook and return the answer body',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'prompt',
      required: true,
      help: 'Prompt to ask the current notebook',
    },
  ],
  columns: ['answer', 'source', 'notebook_id', 'url'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm ask',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const prompt = typeof kwargs.prompt === 'string' ? kwargs.prompt.trim() : String(kwargs.prompt ?? '').trim();
    if (!prompt) {
      throw new ArgumentError('The --prompt option cannot be empty.');
    }

    const answer = await askNotebooklmQuestionViaQuery(page, prompt);
    if (answer) return [answer];

    throw new EmptyResultError(
      'opencli notebooklm ask',
      'NotebookLM did not return an answer for the current prompt.',
    );
  },
});
