import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
  saveNotebooklmVisibleNoteViaRpc,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes-save',
  description: 'Save the currently visible NotebookLM note editor via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'note-id',
      help: 'Stable note id from notebooklm notes list',
    },
  ],
  columns: ['title', 'id', 'content', 'source', 'url'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm notes-save',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const noteId = typeof kwargs['note-id'] === 'string' ? kwargs['note-id'].trim() : '';
    const saved = noteId
      ? await saveNotebooklmVisibleNoteViaRpc(page, noteId)
      : await saveNotebooklmVisibleNoteViaRpc(page);
    if (saved) return [saved];

    if (noteId) {
      throw new CliError(
        'NOTEBOOKLM_NOTE_EDITOR_MISSING',
        `NotebookLM could not save note "${noteId}" because the current page has no visible note editor.`,
        'Open the target note in a visible NotebookLM note editor, then retry notes-save with the same --note-id.',
      );
    }

    throw new EmptyResultError(
      'opencli notebooklm notes-save',
      'Open a NotebookLM note editor first, then retry notes-save.',
    );
  },
});
