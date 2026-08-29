import { cli, Strategy } from '@jackwener/opencli/registry';
import { sendDoubaoMessage } from './utils.js';
export const sendCommand = cli({
    site: 'doubao-app',
    name: 'send',
    access: 'write',
    description: 'Send a message to Doubao desktop app',
    domain: 'doubao-app',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Message text to send' },
    ],
    columns: ['Status', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        await sendDoubaoMessage(page, text);
        return [{ Status: 'Sent', Text: text }];
    },
});
