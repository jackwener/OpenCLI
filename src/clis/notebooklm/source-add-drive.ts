import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  addNotebooklmDriveSourceViaRpc,
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/add-drive',
  aliases: ['source-add-drive'],
  description: 'Add a Google Drive source to the currently opened NotebookLM notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'file-id',
      positional: true,
      required: true,
      help: 'Google Drive file id to add to the current notebook',
    },
    {
      name: 'title',
      positional: true,
      required: true,
      help: 'Display title for the Drive source',
    },
    {
      name: 'mime-type',
      help: 'Drive MIME type, for example application/vnd.google-apps.document',
      default: 'application/vnd.google-apps.document',
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source add-drive',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const fileId = typeof kwargs['file-id'] === 'string'
      ? kwargs['file-id'].trim()
      : String(kwargs['file-id'] ?? '').trim();
    const title = typeof kwargs.title === 'string'
      ? kwargs.title.trim()
      : String(kwargs.title ?? '').trim();
    const mimeType = typeof kwargs['mime-type'] === 'string'
      ? kwargs['mime-type'].trim()
      : String(kwargs['mime-type'] ?? '').trim();

    if (!fileId) {
      throw new ArgumentError('The Google Drive file id cannot be empty.');
    }
    if (!title) {
      throw new ArgumentError('The Drive source title cannot be empty.');
    }
    if (!mimeType) {
      throw new ArgumentError('The Drive MIME type cannot be empty.');
    }

    const source = await addNotebooklmDriveSourceViaRpc(page, fileId, title, mimeType);
    if (source) return [source];

    throw new EmptyResultError(
      'opencli notebooklm source add-drive',
      'NotebookLM did not return the created source for this Drive file.',
    );
  },
});
