import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  addNotebooklmTextSourceViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source-add-text',
  description: 'Add a pasted-text source to the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'Title for the pasted-text source',
    },
    {
      name: 'content',
      positional: true,
      required: true,
      help: 'Text content to add to the current notebook',
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-add-text',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : String(kwargs.title ?? '').trim();
    const content = typeof kwargs.content === 'string' ? kwargs.content.trim() : String(kwargs.content ?? '').trim();
    if (!title) {
      throw new ArgumentError('The source title cannot be empty.');
    }
    if (!content) {
      throw new ArgumentError('The source content cannot be empty.');
    }

    const source = await addNotebooklmTextSourceViaRpc(page, title, content);
    if (source) return [source];

    throw new EmptyResultError(
      'opencli notebooklm source-add-text',
      'NotebookLM did not return the created source for this text payload.',
    );
  },
});
