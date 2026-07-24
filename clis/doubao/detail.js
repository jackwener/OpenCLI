import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOUBAO_DOMAIN, getConversationDetail, parseDoubaoConversationId } from './utils.js';
function parseMaxPages(value) {
    const pages = Number(value ?? 500);
    if (!Number.isInteger(pages) || pages < 1 || pages > 1000) {
        throw new ArgumentError('max-pages must be an integer between 1 and 1000');
    }
    return pages;
}
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
        { name: 'max-pages', type: 'number', default: 500, help: 'Maximum /im/chain/single pages to fetch (1-1000)' },
    ],
    columns: ['Index', 'MessageId', 'Role', 'Type', 'Mode', 'CreatedAt', 'Text', 'Metadata'],
    func: async (page, kwargs) => {
        const conversationId = parseDoubaoConversationId(kwargs.id);
        const maxPages = parseMaxPages(kwargs['max-pages']);
        const { messages, meeting } = await getConversationDetail(page, conversationId, { maxPages });
        if (messages.length === 0 && !meeting) {
            throw new EmptyResultError('doubao detail', `No messages were extracted for conversation ${conversationId}. Verify the conversation ID and login state.`);
        }
        const result = [];
        if (meeting) {
            result.push({
                Index: 0,
                MessageId: '',
                Role: 'Meeting',
                Type: 'meeting',
                Mode: '',
                CreatedAt: null,
                Text: `${meeting.title}${meeting.time ? ` (${meeting.time})` : ''}`,
                Metadata: '{}',
            });
        }
        for (const m of messages) {
            result.push(m);
        }
        return result;
    },
});
