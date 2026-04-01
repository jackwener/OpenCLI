import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmHome,
  removeNotebooklmFromRecentViaRpc,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'remove-from-recent',
  description: 'Remove a NotebookLM notebook from the home recent list by notebook id',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'notebook_id',
      positional: true,
      required: true,
      help: 'Notebook id to remove from recent',
    },
  ],
  columns: ['notebook_id', 'removed_from_recent', 'source'],
  func: async (page: IPage, kwargs) => {
    await requireNotebooklmSession(page);
    await ensureNotebooklmHome(page);

    const notebookId = typeof kwargs.notebook_id === 'string'
      ? kwargs.notebook_id.trim()
      : String(kwargs.notebook_id ?? '').trim();
    if (!notebookId) {
      throw new ArgumentError('The notebook id cannot be empty.');
    }

    const result = await removeNotebooklmFromRecentViaRpc(page, notebookId);
    if (result) return [result];

    throw new EmptyResultError(
      'opencli notebooklm remove-from-recent',
      'NotebookLM did not acknowledge the remove-from-recent request.',
    );
  },
});
