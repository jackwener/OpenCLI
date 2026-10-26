import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    mergeBotEntries,
    normalizeBotEntryRow,
    parseGrokBotId,
    requireGrokUserId,
    runBotRelay,
} from './history-api.js';
import { GROK_DOMAIN, ensureOnGrok } from './utils.js';

cli({
    site: 'grok',
    name: 'bot-transcript',
    access: 'read',
    description: 'Read a Grok bot\'s whole transcript, including archived history',
    example: 'opencli grok bot-transcript 0e3b9a52-6d4f-4c1e-8a27-93f5b1c0d6e4 -f json',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'id', positional: true, required: true, help: 'Bot ID (UUID) or full https://grok.com/bot/<id> URL' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds for the whole read' },
    ],
    columns: ['index', 'id', 'kind', 'type', 'role', 'text', 'createdAt', 'requestId', 'entryVersion', 'replyTo', 'extras'],
    func: async (page, kwargs) => {
        const agentId = parseGrokBotId(kwargs.id);
        await ensureOnGrok(page);
        const userId = await requireGrokUserId(page);
        const { tail, archivePages } = await runBotRelay(page, userId, { type: 'transcript', agentId }, 'grok bot-transcript');
        const entries = mergeBotEntries(tail, archivePages);
        if (!entries.length) {
            throw new EmptyResultError('grok bot-transcript', `Bot ${agentId} has no transcript entries.`);
        }
        return entries.map(normalizeBotEntryRow);
    },
});
