import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { EmptyResultError } from '../../src/errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  findNotebooklmNoteRow,
  getNotebooklmPageState,
  listNotebooklmNotesFromPage,
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
  name: 'notes-get',
  description: 'Get one note from the current NotebookLM notebook by title from the visible note editor',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'note',
      positional: true,
      required: true,
      help: 'Note title or id from the current notebook',
    },
  ],
  columns: ['title', 'content', 'source', 'url'],
  func: async (page: IPage, kwargs) => {
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm notes-get',
        'No NotebookLM notebook is open in the automation workspace. Run `opencli notebooklm open <notebook>` first.',
      );
    }

    const query = typeof kwargs.note === 'string' ? kwargs.note : String(kwargs.note ?? '');
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
