import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  deleteNotebooklmNoteViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmNotesViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes/delete',
  aliases: ['notes-delete'],
  description: 'Delete a note in the current NotebookLM notebook via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'note',
      positional: true,
      required: false,
      help: 'Existing note title when not using --note-id',
    },
    {
      name: 'note-id',
      help: 'Stable note id from notebooklm notes list',
    },
  ],
  columns: ['note_id', 'deleted', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm notes-delete',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const explicitId = typeof kwargs['note-id'] === 'string' ? kwargs['note-id'].trim() : '';
    let noteId = explicitId;

    const rows = await listNotebooklmNotesViaRpc(page);
    if (noteId) {
      const matched = rows.find((row) => row.id === noteId) ?? null;
      if (!matched) {
        throw new CliError(
          'NOTEBOOKLM_NOTE_ID_NOT_FOUND',
          `NotebookLM note id "${noteId}" was not found in the current notebook.`,
          `No NotebookLM note with id "${noteId}" was found in the current notebook.`,
        );
      }
    } else {
      const query = typeof kwargs.note === 'string' ? kwargs.note.trim() : '';
      if (!query) throw new ArgumentError('Provide either a note title or --note-id.');

      const matches = rows.filter((row) => row.title.trim().toLowerCase() === query.toLowerCase());
      if (matches.length === 0) {
        throw new CliError(
          'NOTEBOOKLM_NOTE_NOT_FOUND',
          `NotebookLM note "${query}" was not found in the current notebook.`,
          `No NotebookLM note titled "${query}" was found in the current notebook.`,
        );
      }
      if (matches.length > 1) {
        throw new CliError(
          'NOTEBOOKLM_NOTE_AMBIGUOUS',
          `NotebookLM found multiple notes titled "${query}"`,
          'Use --note-id with notebooklm notes delete when duplicate note titles exist.',
        );
      }
      noteId = matches[0]!.id ?? '';
    }

    const deleted = await deleteNotebooklmNoteViaRpc(page, noteId);
    if (!deleted) {
      throw new CliError(
        'NOTEBOOKLM_NOTE_ID_NOT_FOUND',
        `NotebookLM note id "${noteId}" was not found in the current notebook.`,
        `No NotebookLM note with id "${noteId}" was found in the current notebook.`,
      );
    }

    return [deleted];
  },
});
