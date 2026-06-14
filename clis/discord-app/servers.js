import { cli, Strategy } from '@jackwener/opencli/registry';
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
            return [{ Index: 0, Server: 'No servers found', guild_id: '', url: '' }];
        }
        return servers;
    },
});

export const __test__ = {
    serversCommand,
};
