import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, getDoubaoTranscriptLines, getDoubaoVisibleTurns, navigateToConversation, parseDoubaoConversationId, sendDoubaoMessage, waitForDoubaoResponse } from './utils.js';
export const askCommand = cli({
    site: 'doubao',
    name: 'ask',
    description: 'Send a prompt and wait for the Doubao response',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    timeoutSeconds: 180,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'thread', required: false, help: 'Conversation ID (numeric or full URL)' },
        { name: 'timeout', required: false, help: 'Max seconds to wait (default: 60)', default: '60' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const thread = typeof kwargs.thread === 'string' ? kwargs.thread.trim() : '';
        const timeout = parseInt(kwargs.timeout, 10) || 60;
        if (thread) {
            await navigateToConversation(page, parseDoubaoConversationId(thread));
        }
        const beforeTurns = await getDoubaoVisibleTurns(page);
        const beforeLines = await getDoubaoTranscriptLines(page);
        await sendDoubaoMessage(page, text);
        const response = await waitForDoubaoResponse(page, beforeLines, beforeTurns, text, timeout);
        if (!response) {
            return [
                { Role: 'User', Text: text },
                { Role: 'System', Text: `No response within ${timeout}s. Doubao may still be generating.` },
            ];
        }
        return [
            { Role: 'User', Text: text },
            { Role: 'Assistant', Text: response },
        ];
    },
});
