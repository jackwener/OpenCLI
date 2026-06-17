import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    listDiscordThreads,
    maybeNavigateToDiscordChannel,
    parsePositiveInt,
} from './utils.js';

export const threadsCommand = cli({
    site: 'discord-app',
    name: 'threads',
    access: 'read',
    description: 'List visible Discord forum/thread posts in the active or targeted channel',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', required: false, default: '30', help: 'Maximum thread/post cards to return (default: 30)' },
        { name: 'guild', required: false, help: 'Guild/server id or visible name for targeted thread listing' },
        { name: 'channel', required: false, help: 'Forum/channel id or visible name for targeted thread listing' },
        { name: 'url', required: false, help: 'Discord forum/channel URL to open before listing threads' },
    ],
    columns: ['Index', 'Thread', 'Author', 'Updated', 'Preview', 'guild_id', 'channel_id', 'thread_id', 'url'],
    func: async (page, kwargs) => {
        const limit = parsePositiveInt(kwargs.limit, 30, 'limit');
        await maybeNavigateToDiscordChannel(page, kwargs, { waitForContent: 'threads', contentTimeoutMs: 3000 });
        const rows = await listDiscordThreads(page, limit);
        if (rows.length === 0) {
            throw new EmptyResultError('discord-app threads', 'No visible forum/thread posts were found in the selected Discord channel.');
        }
        return rows;
    },
});

export const __test__ = {
    threadsCommand,
};
