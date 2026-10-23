import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { loadConversation, normalizeTranscriptRows } from './history-api.js';
import { GROK_DOMAIN, ensureOnGrok, parseGrokSessionId } from './utils.js';

cli({
    site: 'grok',
    name: 'transcript',
    access: 'read',
    description: 'Read a full Grok chat, including edit branches, reasoning steps and tool calls',
    example: 'opencli grok transcript 7c4197f2-10a1-4ebb-a84a-fea89f4f1d06 -f json',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID (UUID) or full https://grok.com/c/<id> URL' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds for the whole read' },
    ],
    columns: [
        'index', 'id', 'parentId', 'role', 'text', 'model', 'effort', 'createdAt', 'partial',
        'thinkingStartTime', 'thinkingEndTime', 'steps', 'attachments',
    ],
    func: async (page, kwargs) => {
        const conversationId = parseGrokSessionId(kwargs.id);
        await ensureOnGrok(page);
        const { nodes, responses } = await loadConversation(page, conversationId);
        if (!responses.length) {
            throw new EmptyResultError('grok transcript', `Conversation ${conversationId} has no turns.`);
        }
        return normalizeTranscriptRows(nodes, responses);
    },
});
