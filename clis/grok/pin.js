import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    ensureOnGrok,
    authRequired,
    isLoggedIn,
    parseGrokSessionId,
    clickConversationMenuItem,
} from './utils.js';

const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

function defineToggle(name, accessLabels) {
    cli({
        site: 'grok',
        name,
        access: 'write',
        description: `${name === 'pin' ? 'Pin' : 'Unpin'} a Grok conversation by ID`,
        domain: GROK_DOMAIN,
        strategy: Strategy.COOKIE,
        browser: true,
        siteSession: 'persistent',
        args: [
            { name: 'id', positional: true, type: 'string', required: true, help: 'Conversation UUID or grok.com/c/<uuid> URL' },
        ],
        columns: ['status', 'id'],
        func: async (page, kwargs) => {
            const id = parseGrokSessionId(kwargs.id);
            await ensureOnGrok(page);
            if (!(await isLoggedIn(page))) throw authRequired();

            const result = await clickConversationMenuItem(page, id, accessLabels);
            if (!result || !result.ok) {
                const detail = result?.detail ? ` ${result.detail}` : '';
                throw new CommandExecutionError(`${result?.reason || `Failed to ${name} conversation.`}${detail}`, SESSION_HINT);
            }
            await page.wait(1);
            return [{ status: name === 'pin' ? 'pinned' : 'unpinned', id }];
        },
    });
}

// Grok's context menu shows EITHER "置顶" OR "取消置顶" depending on the
// current pin state, never both. We register two commands that bind to
// the matching label so callers can use whichever they want.
defineToggle('pin', ['置顶', 'pin']);
defineToggle('unpin', ['取消置顶', 'unpin']);
