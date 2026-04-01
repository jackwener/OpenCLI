import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  describeNotebooklmNotebookViaRpc,
  ensureNotebooklmHome,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'describe',
  description: 'Get NotebookLM summary and suggested topics for a notebook id',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'notebook_id',
      positional: true,
      required: true,
      help: 'Notebook id to describe',
    },
  ],
  columns: ['notebook_id', 'summary', 'suggested_topic_count', 'source', 'url'],
  func: async (page: IPage, kwargs) => {
    await requireNotebooklmSession(page);
    await ensureNotebooklmHome(page);

    const notebookId = typeof kwargs.notebook_id === 'string'
      ? kwargs.notebook_id.trim()
      : String(kwargs.notebook_id ?? '').trim();
    if (!notebookId) {
      throw new ArgumentError('The notebook id cannot be empty.');
    }

    const description = await describeNotebooklmNotebookViaRpc(page, notebookId);
    if (description) return [description];

    throw new EmptyResultError(
      'opencli notebooklm describe',
      'NotebookLM did not return a summary or suggested topics for this notebook.',
    );
  },
});
