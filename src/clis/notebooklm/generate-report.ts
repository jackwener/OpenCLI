import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  ensureNotebooklmNotebookBinding,
  generateNotebooklmReportViaRpc,
  getNotebooklmPageState,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'generate/report',
  aliases: ['generate-report'],
  description: 'Generate one NotebookLM report artifact in the current notebook',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'wait',
      type: 'bool',
      default: false,
      help: 'Wait for the generated report artifact to become visible and ready',
    },
  ],
  columns: ['artifact_type', 'status', 'artifact_id', 'created_at', 'source'],
  func: async (page: IPage, kwargs) => {
    await ensureNotebooklmNotebookBinding(page);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new EmptyResultError(
        'opencli notebooklm generate report',
        'Open a specific NotebookLM notebook tab first, then retry.',
      );
    }

    const generated = await generateNotebooklmReportViaRpc(page, {
      wait: Boolean(kwargs.wait),
    });
    if (generated) return [generated];

    throw new EmptyResultError(
      'opencli notebooklm generate report',
      'NotebookLM did not accept a report generation request for the current notebook.',
    );
  },
});
