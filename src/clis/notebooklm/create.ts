import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  createNotebooklmNotebookViaRpc,
  ensureNotebooklmHome,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'create',
  description: 'Create a new NotebookLM notebook with the given title',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'Title for the new notebook',
    },
  ],
  columns: ['id', 'title', 'created_at', 'updated_at', 'source_count', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await requireNotebooklmSession(page);
    await ensureNotebooklmHome(page);

    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : String(kwargs.title ?? '').trim();
    if (!title) {
      throw new ArgumentError('The notebook title cannot be empty.');
    }

    const notebook = await createNotebooklmNotebookViaRpc(page, title);
    if (notebook) return [notebook];

    throw new EmptyResultError(
      'opencli notebooklm create',
      'NotebookLM did not return the created notebook row.',
    );
  },
});
