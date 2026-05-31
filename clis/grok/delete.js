import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    ensureOnGrok,
    authRequired,
    isLoggedIn,
    parseGrokSessionId,
    clickConversationMenuItem,
    normalizeBooleanFlag,
    waitForConversationToDisappear,
} from './utils.js';

const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

cli({
    site: 'grok',
    name: 'delete',
    access: 'write',
    description: 'Delete a Grok conversation by ID. Grok takes effect immediately with no confirmation dialog — require --yes to actually delete.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'id', positional: true, type: 'string', required: true, help: 'Conversation UUID or grok.com/c/<uuid> URL' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually delete (default is a dry-run preview)' },
    ],
    columns: ['status', 'id'],
    func: async (page, kwargs) => {
        const id = parseGrokSessionId(kwargs.id);
        const yes = normalizeBooleanFlag(kwargs.yes);

        await ensureOnGrok(page);
        if (!(await isLoggedIn(page))) throw authRequired();

        if (!yes) {
            return [{ status: 'dry-run (pass --yes to actually delete)', id }];
        }

        const result = await clickConversationMenuItem(page, id, ['删除', 'delete']);
        if (!result || !result.ok) {
            const detail = result?.detail ? ` ${result.detail}` : '';
            throw new CommandExecutionError(`${result?.reason || 'Failed to click delete menu item.'}${detail}`, SESSION_HINT);
        }
        if (!(await waitForConversationToDisappear(page, id))) {
            throw new CommandExecutionError(
                'Delete menu item was clicked, but the conversation is still visible in the sidebar.',
                SESSION_HINT,
            );
        }
        return [{ status: 'deleted', id }];
    },
});
