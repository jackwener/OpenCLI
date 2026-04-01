import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  addNotebooklmFileSourceViaUpload,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/add-file',
  aliases: ['source-add-file'],
  description: 'Add a local file source to the current NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'file-path',
      positional: true,
      required: true,
      help: 'Local file path to upload into the current notebook',
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'status', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source add-file',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const filePath = typeof kwargs['file-path'] === 'string'
      ? kwargs['file-path'].trim()
      : String(kwargs['file-path'] ?? '').trim();
    const source = await addNotebooklmFileSourceViaUpload(page, filePath);
    if (source) return [source];

    throw new EmptyResultError(
      'opencli notebooklm source add-file',
      'NotebookLM did not return a created source for this file upload.',
    );
  },
});
