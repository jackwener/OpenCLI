import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTComposer,
    startNewChat,
    navigateToProject,
} from './utils.js';

export const newCommand = cli({
    site: 'chatgpt',
    name: 'new',
    access: 'read',
    description: 'Start a new ChatGPT web conversation',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'project', valueRequired: true, help: 'Start a new chat inside a ChatGPT project ID or /g/g-p-<id> URL' },
    ],
    columns: ['Status'],
    func: async (page, kwargs = {}) => {
        if (kwargs.project) {
            await navigateToProject(page, kwargs.project);
        } else {
            await startNewChat(page);
        }
        await ensureChatGPTComposer(page, 'ChatGPT new requires a logged-in ChatGPT session with a visible composer.');
        return [{ Status: 'New chat started' }];
    },
});
