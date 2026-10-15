/**
 * Xiaohongshu dm-read — messages of one web-IM conversation (/chat/<conv-id>).
 *
 * Returns the last N rendered messages with the time divider they sit under
 * and whether the viewer sent them. Requires the main-site login.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DEFAULT_MESSAGE_LIMIT,
    MESSAGES_JS,
    SELECTOR_TIMEOUT_S,
    assertConvId,
    clampLimit,
    normalizeMessages,
    openChat,
    requireArray,
} from './dm-helpers.js';

cli({
    site: 'xiaohongshu',
    name: 'dm-read',
    access: 'read',
    description: '小红书私信消息记录 (one conversation)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'conv', required: true, positional: true, help: 'Conversation id from `xiaohongshu dm-list`' },
        { name: 'limit', type: 'int', default: DEFAULT_MESSAGE_LIMIT, help: 'Last N messages to return' },
    ],
    columns: ['time', 'from', 'mine', 'text'],
    func: async (page, kwargs) => {
        try {
            const convId = assertConvId(kwargs.conv);
            await openChat(page, convId);
            await page.wait({ selector: '.xhs-im-msg-list', timeout: SELECTOR_TIMEOUT_S });
            const rows = requireArray(await page.evaluate(MESSAGES_JS), 'message-list');
            return normalizeMessages(rows, clampLimit(kwargs.limit, DEFAULT_MESSAGE_LIMIT));
        } catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`xiaohongshu/dm-read failed: ${err?.message ?? String(err)}`);
        }
    },
});
