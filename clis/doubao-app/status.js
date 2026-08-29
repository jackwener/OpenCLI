import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { inspectSurfaceScript, isDoubaoChatUrl } from './utils.js';
export const statusCommand = cli({
    site: 'doubao-app',
    name: 'status',
    access: 'read',
    description: 'Check CDP connection to Doubao desktop app',
    domain: 'doubao-app',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'Url', 'Title'],
    func: async (page) => {
        const surface = await page.evaluate(inspectSurfaceScript());
        if (!isDoubaoChatUrl(surface?.url) || !surface?.composerReady) {
            throw new CommandExecutionError(
                `Connected to a non-chat Doubao surface: ${surface?.url || 'unknown URL'}`,
                'Open a Doubao conversation. If OPENCLI_CDP_TARGET is set, remove it or point it at "doubao-chat/chat".',
            );
        }
        return [{ Status: 'Connected', Url: surface.url, Title: surface.title }];
    },
});
