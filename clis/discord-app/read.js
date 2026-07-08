import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    assertDiscordMessageRowsBelongToTarget,
    maybeNavigateToDiscordChannel,
    parsePositiveInt,
    readDiscordMessages,
} from './utils.js';

export const readCommand = cli({
    site: 'discord-app',
    name: 'read',
    access: 'read',
    description: 'Read recent messages from the active or targeted Discord channel',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'count', required: false, help: 'Number of messages to read (default: 20)', default: '20' },
        { name: 'guild', required: false, help: 'Guild/server id or visible name for targeted reads' },
        { name: 'channel', required: false, help: 'Channel id or visible name for targeted reads' },
        { name: 'url', required: false, help: 'Discord channel URL to open before reading' },
    ],
    columns: ['Author', 'Time', 'Message', 'channel_id', 'message_id'],
    func: async (page, kwargs) => {
        const count = parsePositiveInt(kwargs.count, 20, 'count');
        const target = await maybeNavigateToDiscordChannel(page, kwargs, { waitForContent: 'messages' });
        const messages = assertDiscordMessageRowsBelongToTarget(
            await readDiscordMessages(page, count),
            target,
            'Discord channel read',
        );
        if (messages.length === 0) {
            throw new EmptyResultError('discord-app read', 'No messages were found in the selected Discord channel.');
        }
        return messages;
    },
});

export const __test__ = {
    readCommand,
};
