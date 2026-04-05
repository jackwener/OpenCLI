import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import {
  buildNotebooklmNotebookUrl,
  getNotebooklmPageState,
  parseNotebooklmNotebookTarget,
  readCurrentNotebooklm,
  requireNotebooklmSession,
} from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'open',
  aliases: ['select'],
  description: 'Open one NotebookLM notebook in the automation workspace by id or URL',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'notebook',
      positional: true,
      required: true,
      help: 'Notebook id from list output, or a full NotebookLM notebook URL',
    },
  ],
  columns: ['id', 'title', 'url', 'source'],
  func: async (page: IPage, kwargs) => {
    const notebookId = parseNotebooklmNotebookTarget(String(kwargs.notebook ?? ''));
    await page.goto(buildNotebooklmNotebookUrl(notebookId));
    await page.wait(2);
    await requireNotebooklmSession(page);

    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') {
      throw new CliError(
        'NOTEBOOKLM_OPEN_FAILED',
        `NotebookLM notebook "${notebookId}" did not open in the automation workspace`,
        'Run `opencli notebooklm list -f json` first and pass a valid notebook id.',
      );
    }
    if (state.notebookId !== notebookId) {
      console.warn(
        `[notebooklm open] expected notebook "${notebookId}" but page reports "${state.notebookId}"; continuing`,
      );
    }

    const current = await readCurrentNotebooklm(page);
    if (!current) {
      throw new EmptyResultError(
        'opencli notebooklm open',
        'NotebookLM notebook metadata was not found after navigation.',
      );
    }

    return [current];
  },
});
