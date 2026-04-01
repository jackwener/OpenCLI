import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  createNotebooklmNoteViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes/create',
  aliases: ['notes-create'],
  description: 'Create a new note in the current NotebookLM notebook via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'Title for the new note',
    },
    {
      name: 'content',
      positional: true,
      required: false,
      help: 'Initial content for the new note',
    },
  ],
  columns: ['title', 'id', 'content', 'source', 'url'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm notes-create',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : '';
    if (!title) throw new ArgumentError('Provide a note title.');

    const content = typeof kwargs.content === 'string' ? kwargs.content : String(kwargs.content ?? '');
    const created = await createNotebooklmNoteViaRpc(page, title, content);
    if (!created) {
      throw new EmptyResultError(
        'opencli notebooklm notes-create',
        'NotebookLM did not return a created note id. Retry from the target notebook page.',
      );
    }

    return [created];
  },
});
