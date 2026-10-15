/**
 * Xiaohongshu dm-list — conversations in the web IM (https://www.xiaohongshu.com/chat).
 *
 * Reads the rendered conversation cards; the IM API is signed in-page and cannot
 * be replayed from outside, so we read the DOM like follow.js / publish.js do.
 * Requires the main-site login (separate from the creator center).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CONVERSATIONS_JS,
    DEFAULT_CONVERSATION_LIMIT,
    SELECTOR_TIMEOUT_S,
    clampLimit,
    normalizeConversations,
    openChat,
    requireArray,
} from './dm-helpers.js';

cli({
    site: 'xiaohongshu',
    name: 'dm-list',
    access: 'read',
    description: '小红书私信会话列表 (web IM)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_CONVERSATION_LIMIT, help: 'Max conversations to return' },
    ],
    columns: ['id', 'name', 'time', 'summary', 'unread', 'pinned', 'group'],
    func: async (page, kwargs) => {
        try {
            await openChat(page);
            await page.wait({ selector: '.xhs-im-conv-item', timeout: SELECTOR_TIMEOUT_S });
            const rows = requireArray(await page.evaluate(CONVERSATIONS_JS), 'conversation-list');
            return normalizeConversations(rows, clampLimit(kwargs.limit, DEFAULT_CONVERSATION_LIMIT));
        } catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`xiaohongshu/dm-list failed: ${err?.message ?? String(err)}`);
        }
    },
});
