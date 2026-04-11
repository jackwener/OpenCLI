import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, getDoubaoVisibleTurns, navigateToConversation, parseDoubaoConversationId } from './utils.js';
export const readCommand = cli({
    site: 'doubao',
    name: 'read',
    description: 'Read the current Doubao conversation history',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'thread', required: false, help: 'Conversation ID (numeric or full URL)' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const thread = typeof kwargs.thread === 'string' ? kwargs.thread.trim() : '';
        if (thread) {
            await navigateToConversation(page, parseDoubaoConversationId(thread));
        }
        const turns = await getDoubaoVisibleTurns(page);
        if (turns.length > 0)
            return turns;
        return [{ Role: 'System', Text: 'No visible Doubao messages were found.' }];
    },
});
