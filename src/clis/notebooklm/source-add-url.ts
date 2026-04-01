import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  addNotebooklmUrlSourceViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source-add-url',
  description: 'Add a URL source to the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'URL to add to the current notebook',
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source-add-url',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const url = typeof kwargs.url === 'string' ? kwargs.url.trim() : String(kwargs.url ?? '').trim();
    if (!url) {
      throw new ArgumentError('The source URL cannot be empty.');
    }

    const source = await addNotebooklmUrlSourceViaRpc(page, url);
    if (source) return [source];

    throw new EmptyResultError(
      'opencli notebooklm source-add-url',
      'NotebookLM did not return the created source for this URL.',
    );
  },
});
