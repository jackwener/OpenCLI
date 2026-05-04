import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, sendDoubaoMessage } from './utils.js';
export const sendCommand = cli({
    site: 'doubao',
    name: 'send',
    access: 'write',
    description: 'Send a message to Doubao web chat',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [{ name: 'text', required: true, positional: true, help: 'Message to send' }],
    columns: ['Status', 'SubmittedBy', 'InjectedText'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const submittedBy = await sendDoubaoMessage(page, text);
        return [{
                Status: 'Success',
                SubmittedBy: submittedBy,
                InjectedText: text,
            }];
    },
});
