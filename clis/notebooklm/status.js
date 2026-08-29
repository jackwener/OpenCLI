import { cli, Strategy } from '@jackwener/opencli/registry';
import { isNotebooklmHost, NOTEBOOKLM_DOMAIN, NOTEBOOKLM_HOME_URL, NOTEBOOKLM_SITE } from './shared.js';
import { classifyNotebooklmPage, getNotebooklmPageState } from './utils.js';
cli({
    site: NOTEBOOKLM_SITE,
    name: 'status',
    access: 'read',
    description: 'Check NotebookLM page availability and login state in the current Chrome session',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['status', 'login', 'page', 'url', 'title', 'notebooks'],
    func: async (page) => {
        const currentUrl = typeof page.getCurrentUrl === 'function'
            ? await page.getCurrentUrl().catch(() => null)
            : null;
        if (classifyNotebooklmPage(currentUrl) === 'unknown') {
            await page.goto(NOTEBOOKLM_HOME_URL);
            await page.wait(2);
        }
        const state = await getNotebooklmPageState(page);
        return [{
                status: isNotebooklmHost(state.hostname) ? 'Connected' : 'Unavailable',
                login: state.loginRequired ? 'Required' : 'OK',
                page: state.kind,
                url: state.url,
                title: state.title,
                notebooks: state.notebookCount,
            }];
    },
});
