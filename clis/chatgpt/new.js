import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTComposer,
    startNewChat,
} from './utils.js';

export const newCommand = cli({
    site: 'chatgpt',
    name: 'new',
    access: 'read',
    description: 'Start a new ChatGPT web conversation',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        await startNewChat(page);
        await ensureChatGPTComposer(page, 'ChatGPT new requires a logged-in ChatGPT session with a visible composer.');
        return [{ Status: 'New chat started' }];
    },
});
