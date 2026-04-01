import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  listNotebooklmNotesViaRpc,
  renameNotebooklmNoteViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes/rename',
  aliases: ['notes-rename'],
  description: 'Rename a note in the current NotebookLM notebook via RPC',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'New title for the note',
    },
    {
      name: 'note',
      help: 'Existing note title when not using --note-id',
    },
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
        'opencli notebooklm notes-rename',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : '';
    if (!title) throw new ArgumentError('Provide the new note title.');

    const explicitId = typeof kwargs['note-id'] === 'string' ? kwargs['note-id'].trim() : '';
    let noteId = explicitId;

    if (!noteId) {
      const query = typeof kwargs.note === 'string' ? kwargs.note.trim() : '';
      if (!query) throw new ArgumentError('Provide either a note title or --note-id.');

      const rows = await listNotebooklmNotesViaRpc(page);
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
          'Use --note-id with notebooklm notes rename when duplicate note titles exist.',
        );
      }
      noteId = matches[0]!.id ?? '';
    }

    const renamed = await renameNotebooklmNoteViaRpc(page, noteId, title);
    if (!renamed) {
      throw new CliError(
        'NOTEBOOKLM_NOTE_ID_NOT_FOUND',
        `NotebookLM note id "${noteId}" was not found in the current notebook.`,
        `No NotebookLM note with id "${noteId}" was found in the current notebook.`,
      );
    }

    return [renamed];
  },
});
