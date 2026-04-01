import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
  waitForNotebooklmSourceReadyViaRpc,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/wait',
  aliases: ['source-wait'],
  description: 'Wait until a NotebookLM source is fully processed',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'source-id',
      positional: true,
      required: true,
      help: 'Source id to wait for',
    },
    {
      name: 'initial-interval',
      help: 'Initial polling interval in seconds',
      default: 1,
    },
    {
      name: 'max-interval',
      help: 'Maximum polling interval in seconds',
      default: 10,
    },
    {
      name: 'timeout',
      help: 'Overall wait timeout in seconds',
      default: 120,
    },
  ],
  columns: ['title', 'id', 'type', 'size', 'status', 'created_at', 'updated_at', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm source wait',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const sourceId = typeof kwargs['source-id'] === 'string'
      ? kwargs['source-id'].trim()
      : String(kwargs['source-id'] ?? '').trim();
    const source = await waitForNotebooklmSourceReadyViaRpc(page, sourceId, {
      timeout: Number(kwargs.timeout ?? 120),
      initialInterval: Number(kwargs['initial-interval'] ?? 1),
      maxInterval: Number(kwargs['max-interval'] ?? 10),
    });
    if (source) return [source];

    throw new EmptyResultError(
      'opencli notebooklm source wait',
      `NotebookLM did not return source "${sourceId}" after waiting.`,
    );
  },
});
