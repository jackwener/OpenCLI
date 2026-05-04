import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, startNewDoubaoChat } from './utils.js';
export const newCommand = cli({
    site: 'doubao',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in Doubao web chat',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Action'],
    func: async (page) => {
        const action = await startNewDoubaoChat(page);
        return [{
                Status: 'Success',
                Action: action === 'navigate' ? 'Reloaded /chat as fallback' : `Clicked ${action}`,
            }];
    },
});
