import { cli, Strategy } from '@jackwener/opencli/registry';
import { inspectMercury } from './utils.js';

cli({
    site: 'mercury',
    name: 'check-login',
    description: 'Open Mercury reimbursements and report whether the active browser profile is logged in',
    access: 'read',
    example: 'opencli --profile <profile> mercury check-login -f json',
    domain: 'app.mercury.com',
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    defaultWindowMode: 'foreground',
    navigateBefore: false,
    args: [],
    columns: ['status', 'loggedIn', 'url', 'hasSubmitExpense', 'hasReimbursements', 'title'],
    func: async (page) => {
        const state = await inspectMercury(page);
        return [{
            status: state.loggedIn ? 'ready' : 'needs_login',
            loggedIn: state.loggedIn,
            url: state.url,
            hasSubmitExpense: state.hasSubmitExpense,
            hasReimbursements: state.hasReimbursements,
            title: state.title,
        }];
    },
});
