import { cli, Strategy } from '@jackwener/opencli/registry';
import { listDiscordChannels } from './utils.js';

export const channelsCommand = cli({
    site: 'discord-app',
    name: 'channels',
    access: 'read',
    description: 'List channels in the current Discord server',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Channel', 'Type', 'guild_id', 'channel_id', 'url'],
    func: async (page) => {
        const channels = await listDiscordChannels(page);
        if (channels.length === 0) {
            return [{ Index: 0, Channel: 'No channels found', Type: '—', guild_id: '', channel_id: '', url: '' }];
        }
        return channels;
    },
});

export const __test__ = {
    channelsCommand,
};
