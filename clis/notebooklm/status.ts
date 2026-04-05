import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_HOME_URL, NOTEBOOKLM_SITE } from './shared.js';
import { getNotebooklmPageState } from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'status',
  description: 'Check NotebookLM page availability and login state in the current Chrome session',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['status', 'login', 'page', 'url', 'title', 'notebooks'],
  func: async (page: IPage) => {
    const currentUrl = await page.getCurrentUrl?.().catch(() => null);
    if (!currentUrl || !currentUrl.includes(NOTEBOOKLM_DOMAIN)) {
      await page.goto(NOTEBOOKLM_HOME_URL);
      await page.wait(2);
    }

    const state = await getNotebooklmPageState(page);
    return [{
      status: state.hostname === NOTEBOOKLM_DOMAIN ? 'Connected' : 'Unavailable',
      login: state.loginRequired ? 'Required' : 'OK',
      page: state.kind,
      url: state.url,
      title: state.title,
      notebooks: state.notebookCount,
    }];
  },
});
