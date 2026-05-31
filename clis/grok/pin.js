import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    ensureOnGrok,
    authRequired,
    isLoggedIn,
    parseGrokSessionId,
    clickConversationMenuItem,
    getPinStateFromMenuLabels,
    readConversationMenuLabels,
    waitForConversationPinState,
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

            const expectedState = name === 'pin' ? 'pinned' : 'unpinned';
            const before = await readConversationMenuLabels(page, id);
            if (!before.ok) {
                const detail = before.detail ? ` ${before.detail}` : '';
                throw new CommandExecutionError(`${before.reason || `Failed to inspect ${name} state.`}${detail}`, SESSION_HINT);
            }
            if (getPinStateFromMenuLabels(before.labels) === expectedState) {
                return [{ status: `already-${expectedState}`, id }];
            }

            const result = await clickConversationMenuItem(page, id, accessLabels);
            if (!result || !result.ok) {
                const detail = result?.detail ? ` ${result.detail}` : '';
                throw new CommandExecutionError(`${result?.reason || `Failed to ${name} conversation.`}${detail}`, SESSION_HINT);
            }
            const verified = await waitForConversationPinState(page, id, expectedState);
            if (!verified.ok) {
                const labels = verified.labels?.length ? ` labels=${JSON.stringify(verified.labels)}` : '';
                throw new CommandExecutionError(
                    `${name} menu item was clicked, but the conversation did not verify as ${expectedState}.${labels}`,
                    SESSION_HINT,
                );
            }
            return [{ status: name === 'pin' ? 'pinned' : 'unpinned', id }];
        },
    });
}

// Grok's context menu shows EITHER "置顶" OR "取消置顶" depending on the
// current pin state, never both. We register two commands that bind to
// the matching label so callers can use whichever they want.
defineToggle('pin', ['置顶', 'pin']);
defineToggle('unpin', ['取消置顶', 'unpin']);
