import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeBotRow, requireGrokUserId, runBotRelay } from './history-api.js';
import { GROK_DOMAIN, ensureOnGrok } from './utils.js';

cli({
    site: 'grok',
    name: 'bots',
    access: 'read',
    description: 'List the account\'s Grok bots (grok.com/bot/<id>)',
    example: 'opencli grok bots -f json',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [],
    columns: ['index', 'id', 'name', 'description', 'isGroup', 'createdAt', 'updatedAt', 'lastActivityAt', 'url'],
    func: async (page) => {
        await ensureOnGrok(page);
        const userId = await requireGrokUserId(page);
        const { agents } = await runBotRelay(page, userId, { type: 'agents' }, 'grok bots');
        if (!Array.isArray(agents)) {
            throw new CommandExecutionError('grok bots returned a malformed payload', 'Expected listAgents to return an array.');
        }
        if (!agents.length) {
            throw new EmptyResultError('grok bots', 'The signed-in account has no Grok bots.');
        }
        return agents.map(normalizeBotRow);
    },
});
