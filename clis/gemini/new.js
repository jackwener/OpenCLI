import { cli, Strategy } from '@jackwener/opencli/registry';
import { GEMINI_DOMAIN, startNewGeminiChat } from './utils.js';
export const newCommand = cli({
    site: 'gemini',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in Gemini web chat',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Action'],
    func: async (page) => {
        const action = await startNewGeminiChat(page);
        return [{
                Status: 'Success',
                Action: action === 'navigate' ? 'Reloaded /app as fallback' : 'Clicked New chat',
            }];
    },
});
