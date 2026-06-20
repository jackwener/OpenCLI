import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    navigateToDiscordTarget,
    parsePositiveInt,
    resolveDiscordChannelTarget,
} from './utils.js';

export const gotoCommand = cli({
    site: 'discord-app',
    name: 'goto',
    access: 'read',
    description: 'Open a Discord channel by id/name/url without sending messages',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'guild', required: false, help: 'Guild/server id or visible name' },
        { name: 'channel', required: false, help: 'Channel id or visible name' },
        { name: 'url', required: false, help: 'Discord channel URL' },
        { name: 'timeout', required: false, default: '8', help: 'Seconds to wait for Discord to show the route (default: 8)' },
    ],
    columns: ['Status', 'guild_id', 'channel_id', 'url'],
    func: async (page, kwargs) => {
        const timeoutSeconds = parsePositiveInt(kwargs.timeout, 8, 'timeout');
        const target = await resolveDiscordChannelTarget(page, kwargs, { required: true });
        await navigateToDiscordTarget(page, target, { timeoutMs: timeoutSeconds * 1000 });
        return [{
            Status: 'Opened',
            guild_id: target.guild_id,
            channel_id: target.channel_id,
            url: target.url,
        }];
    },
});

export const __test__ = {
    gotoCommand,
};
