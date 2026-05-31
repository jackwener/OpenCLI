import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { GROK_DOMAIN } from './utils.js';

// Known follow-up: triggering the inline rename input requires firing
// pointer events at the menu item via the radix focus group AT real
// coordinates. Plain DOM-synthesized click and CDP `browser click`
// both let the JS click handler register but never spawn the inline
// editor. Tracked separately.
cli({
    site: 'grok',
    name: 'rename',
    access: 'write',
    description: 'Rename a Grok conversation by ID (NOT YET IMPLEMENTED — see commit message; pin/unpin/delete work)',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'id', positional: true, type: 'string', required: true, help: 'Conversation UUID or grok.com/c/<uuid> URL' },
        { name: 'title', positional: true, type: 'string', required: true, help: 'New title' },
    ],
    columns: ['status'],
    func: async () => {
        throw new CommandExecutionError(
            'grok rename is not yet implemented — radix menu onSelect for "Rename" does not respond to programmatic clicks. Workaround: rename via the Grok UI; or use opencli grok delete + ask to recreate.',
            '',
        );
    },
});
