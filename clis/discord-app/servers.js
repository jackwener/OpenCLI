import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { listDiscordServers } from './utils.js';

export const serversCommand = cli({
    site: 'discord-app',
    name: 'servers',
    access: 'read',
    description: 'List all Discord servers (guilds) in the sidebar',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Server', 'guild_id', 'url'],
    func: async (page) => {
        const servers = await listDiscordServers(page);
        if (servers.length === 0) {
            throw new EmptyResultError('discord-app servers', 'No Discord servers were found in the sidebar.');
        }
        return servers;
    },
});

export const __test__ = {
    serversCommand,
};
