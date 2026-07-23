import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOUBAO_DOMAIN, getConversationDetail, parseDoubaoConversationId } from './utils.js';
export const detailCommand = cli({
    site: 'doubao',
    name: 'detail',
    access: 'read',
    description: 'Read a specific Doubao conversation by ID',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Conversation ID (numeric or full URL)' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const conversationId = parseDoubaoConversationId(kwargs.id);
        const { messages, meeting } = await getConversationDetail(page, conversationId);
        if (messages.length === 0 && !meeting) {
            throw new EmptyResultError('doubao detail', `No messages were extracted for conversation ${conversationId}. Verify the conversation ID and login state.`);
        }
        const result = [];
        if (meeting) {
            result.push({
                Role: 'Meeting',
                Text: `${meeting.title}${meeting.time ? ` (${meeting.time})` : ''}`,
            });
        }
        for (const m of messages) {
            result.push({ Role: m.Role, Text: m.Text });
        }
        return result;
    },
});
