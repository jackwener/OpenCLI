import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  getNotebooklmPageState,
  requireNotebooklmSession,
  waitForNotebooklmSourcesReadyViaRpc,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'source/wait-for-sources',
  aliases: ['source-wait-for-sources'],
  description: 'Wait until one or more NotebookLM sources are fully processed',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'source-ids',
      positional: true,
      required: true,
      help: 'Comma-separated source ids to wait for',
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
        'opencli notebooklm source wait-for-sources',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const rawIds = typeof kwargs['source-ids'] === 'string'
      ? kwargs['source-ids']
      : String(kwargs['source-ids'] ?? '');
    const sourceIds = rawIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (sourceIds.length === 0) {
      throw new ArgumentError('Provide at least one source id.');
    }

    return waitForNotebooklmSourcesReadyViaRpc(page, sourceIds, {
      timeout: Number(kwargs.timeout ?? 120),
      initialInterval: Number(kwargs['initial-interval'] ?? 1),
      maxInterval: Number(kwargs['max-interval'] ?? 10),
    });
  },
});
