import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    CHATGPT_MODEL_CHOICES,
    selectChatGPTModel,
} from './utils.js';

export const modelCommand = cli({
    site: 'chatgpt',
    name: 'model',
    access: 'write',
    description: 'Switch ChatGPT web intelligence level (instant, medium, high, extra-high, pro; thinking aliases high)',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'model', required: true, positional: true, help: 'Intelligence level to switch to; thinking is a backward-compatible alias for high', choices: CHATGPT_MODEL_CHOICES },
    ],
    columns: ['Status', 'Model'],
    func: async (page, kwargs) => {
        const result = await selectChatGPTModel(page, kwargs.model);
        return [{ Status: result.Status, Model: result.Model }];
    },
});
