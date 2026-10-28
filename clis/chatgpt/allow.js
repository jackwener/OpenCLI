import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    answerChatGPTAppPermission,
    ensureOnChatGPT,
} from './utils.js';

export const allowCommand = cli({
    site: 'chatgpt',
    name: 'allow',
    access: 'write',
    description: 'Answer the open ChatGPT app permission prompt ("Allow ChatGPT to use <app>?")',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'choice', positional: true, required: true, choices: ['once', 'always', 'deny'], help: 'Allow once, always allow, or deny' },
    ],
    columns: ['Status', 'Clicked', 'Prompt'],
    func: async (page, kwargs) => {
        await ensureOnChatGPT(page);
        const answered = await answerChatGPTAppPermission(page, String(kwargs.choice));
        return [{ Status: 'Answered', Clicked: answered.clicked, Prompt: answered.prompt }];
    },
});
