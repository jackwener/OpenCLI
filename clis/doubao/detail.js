import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, getConversationDetail, parseDoubaoConversationId } from './utils.js';
export const detailCommand = cli({
    site: 'doubao',
    name: 'detail',
    description: 'Read a specific Doubao conversation by ID',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Conversation ID (numeric or full URL)' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const conversationId = parseDoubaoConversationId(kwargs.id);
        const { messages, meeting } = await getConversationDetail(page, conversationId);
        if (messages.length === 0 && !meeting) {
            return [{ Role: 'System', Text: 'No messages found. Verify the conversation ID.' }];
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
