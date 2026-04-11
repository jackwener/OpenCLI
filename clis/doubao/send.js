import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, navigateToConversation, parseDoubaoConversationId, sendDoubaoMessage } from './utils.js';
export const sendCommand = cli({
    site: 'doubao',
    name: 'send',
    description: 'Send a message to Doubao web chat',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'text', required: true, positional: true, help: 'Message to send' },
        { name: 'thread', required: false, help: 'Conversation ID (numeric or full URL)' },
    ],
    columns: ['Status', 'SubmittedBy', 'InjectedText'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const thread = typeof kwargs.thread === 'string' ? kwargs.thread.trim() : '';
        if (thread) {
            await navigateToConversation(page, parseDoubaoConversationId(thread));
        }
        const submittedBy = await sendDoubaoMessage(page, text);
        return [{
                Status: 'Success',
                SubmittedBy: submittedBy,
                InjectedText: text,
            }];
    },
});
