import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  getNotebooklmPageState,
  listNotebooklmNotesFromPage,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'note-list',
  aliases: ['notes-list'],
  description: 'List saved notes from the Studio panel of the current NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['title', 'created_at', 'source', 'url'],
  func: async (page: IPage) => {
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm note-list',
        'No NotebookLM notebook is open in the automation workspace. Run `opencli notebooklm open <notebook>` first.',
      );
    }

    const rows = await listNotebooklmNotesFromPage(page);
    if (rows.length > 0) return rows;

    throw new EmptyResultError(
      'opencli notebooklm note-list',
      'No NotebookLM notes are visible in the Studio panel. Reload the notebook page or close the note editor and retry.',
    );
  },
});
