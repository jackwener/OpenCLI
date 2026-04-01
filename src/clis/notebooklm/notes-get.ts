import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  findNotebooklmNoteRow,
  getNotebooklmPageState,
  listNotebooklmNotesFromPage,
  listNotebooklmNotesViaRpc,
  readNotebooklmVisibleNoteFromPage,
  requireNotebooklmSession,
} from './utils.js';

function matchesNoteTitle(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const normalized = title.trim().toLowerCase();
  return normalized === needle || normalized.includes(needle);
}

cli({
  site: NOTEBOOKLM_SITE,
  name: 'notes/get',
  aliases: ['notes-get'],
  description: 'Get one note from the current NotebookLM notebook by title from the visible note editor',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'note',
      positional: true,
      required: false,
      help: 'Note title or id from the current notebook',
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
        'opencli notebooklm notes-get',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const noteId = typeof kwargs['note-id'] === 'string' ? kwargs['note-id'].trim() : '';
    if (noteId) {
      const rows = await listNotebooklmNotesViaRpc(page);
      const matched = rows.find((row) => row.id === noteId) ?? null;
      if (matched) return [matched];

      throw new CliError(
        'NOTEBOOKLM_NOTE_ID_NOT_FOUND',
        `NotebookLM note id "${noteId}" was not found in the current notebook.`,
        `No NotebookLM note with id "${noteId}" was found in the current notebook.`,
      );
    }

    const query = typeof kwargs.note === 'string' ? kwargs.note : String(kwargs.note ?? '');
    if (!query.trim()) {
      throw new ArgumentError('Provide either a note title or --note-id.');
    }
    const visible = await readNotebooklmVisibleNoteFromPage(page);
    if (visible && matchesNoteTitle(visible.title, query)) return [visible];

    const rows = await listNotebooklmNotesFromPage(page);
    const listed = findNotebooklmNoteRow(rows, query);
    if (listed) {
      throw new EmptyResultError(
        'opencli notebooklm notes-get',
        `Note "${query}" is listed in Studio, but opencli currently reads note content only from the visible note editor. Open that note in NotebookLM, then retry.`,
      );
    }

    throw new EmptyResultError(
      'opencli notebooklm notes-get',
      `Note "${query}" was not found in the current notebook.`,
    );
  },
});
