import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    assertDiscordMessageRowsBelongToTarget,
    navigateToDiscordTarget,
    parsePositiveInt,
    readDiscordMessages,
    resolveDiscordThreadTarget,
} from './utils.js';

export const threadReadCommand = cli({
    site: 'discord-app',
    name: 'thread-read',
    access: 'read',
    description: 'Read recent messages from a Discord thread/post by id or URL',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'thread', required: false, help: 'Thread/post id, or a full Discord thread/post URL' },
        { name: 'count', required: false, default: '20', help: 'Number of messages to read (default: 20)' },
        { name: 'guild', required: false, help: 'Parent guild/server id or visible name' },
        { name: 'channel', required: false, help: 'Parent forum/channel id or visible name' },
        { name: 'url', required: false, help: 'Discord thread/post URL' },
    ],
    columns: ['Author', 'Time', 'Message', 'channel_id', 'message_id'],
    func: async (page, kwargs) => {
        const count = parsePositiveInt(kwargs.count, 20, 'count');
        const target = await resolveDiscordThreadTarget(page, kwargs);
        await navigateToDiscordTarget(page, target, { waitForContent: 'messages' });
        const rows = assertDiscordMessageRowsBelongToTarget(
            await readDiscordMessages(page, count),
            target,
            'Discord thread read',
        );
        if (rows.length === 0) {
            throw new EmptyResultError('discord-app thread-read', 'No messages were found in the selected Discord thread.');
        }
        return rows;
    },
});

export const __test__ = {
    threadReadCommand,
};
