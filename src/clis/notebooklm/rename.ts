import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmHome,
  renameNotebooklmNotebookViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'rename',
  description: 'Rename a NotebookLM notebook by notebook id',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'notebook_id',
      positional: true,
      required: true,
      help: 'Notebook id to rename',
    },
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'New title for the notebook',
    },
  ],
  columns: ['id', 'title', 'updated_at', 'source_count', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await requireNotebooklmSession(page);
    await ensureNotebooklmHome(page);

    const notebookId = typeof kwargs.notebook_id === 'string'
      ? kwargs.notebook_id.trim()
      : String(kwargs.notebook_id ?? '').trim();
    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : String(kwargs.title ?? '').trim();
    if (!notebookId) {
      throw new ArgumentError('The notebook id cannot be empty.');
    }
    if (!title) {
      throw new ArgumentError('The notebook title cannot be empty.');
    }

    const notebook = await renameNotebooklmNotebookViaRpc(page, notebookId, title);
    if (notebook) return [notebook];

    throw new EmptyResultError(
      'opencli notebooklm rename',
      'NotebookLM did not return the updated notebook row after rename.',
    );
  },
});
