import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { getNotebooklmOutputLanguageViaRpc } from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'language/get',
  aliases: ['language-get'],
  description: 'Get the current global NotebookLM output language',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['language', 'name', 'source'],
  func: async (page: IPage) => {
    const row = await getNotebooklmOutputLanguageViaRpc(page);
    if (row) return [row];
    throw new EmptyResultError(
      'opencli notebooklm language-get',
      'NotebookLM did not return the current output language.',
    );
  },
});
