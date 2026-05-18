import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    buildChatUrl,
    buildClickInboxConversationEvaluate,
    buildExtractChatStateEvaluate,
    DEFAULT_MESSAGE_LIMIT,
    MAX_MESSAGE_LIMIT,
    normalizeLimit,
    normalizeRank,
    requireClickResult,
    requireEvaluateObject,
} from './im.js';
import { normalizeNumericId } from './utils.js';

cli({
    site: 'xianyu',
    name: 'messages',
    access: 'read',
    description: '读取指定闲鱼私信会话的最近聊天内容',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'item_id', positional: true, help: '闲鱼商品 item_id' },
        { name: 'user_id', positional: true, help: '聊一聊对方的 user_id / peerUserId' },
        { name: 'limit', type: 'int', default: DEFAULT_MESSAGE_LIMIT, help: 'Number of visible messages to return' },
        { name: 'rank', type: 'int', default: 0, help: 'Conversation rank from xianyu inbox; clicks the visible row instead of requiring IDs' },
    ],
    columns: ['index', 'peer_name', 'item_title', 'message', 'item_id', 'peer_user_id', 'url'],
    func: async (page, kwargs) => {
        const hasItemId = kwargs.item_id != null && kwargs.item_id !== '';
        const hasUserId = kwargs.user_id != null && kwargs.user_id !== '';
        const rank = normalizeRank(kwargs.rank);
        if (rank > 0 && (hasItemId || hasUserId)) {
            throw new ArgumentError('xianyu messages accepts either item_id/user_id or --rank, not both');
        }
        if (rank === 0 && hasItemId !== hasUserId) {
            throw new ArgumentError('xianyu messages requires both item_id and user_id, or --rank from xianyu inbox');
        }
        if (rank === 0 && !hasItemId && !hasUserId) {
            throw new ArgumentError('xianyu messages requires item_id/user_id or --rank from xianyu inbox');
        }
        const hasIds = hasItemId && hasUserId;
        const itemId = hasIds ? normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192') : '';
        const userId = hasIds ? normalizeNumericId(kwargs.user_id, 'user_id', '3650092411') : '';
        const limit = normalizeLimit(kwargs.limit, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, 'messages --limit');
        let url = '';
        if (hasIds) {
            url = buildChatUrl(itemId, userId);
            await page.goto(url);
        } else {
            if (!page.getCurrentUrl || !/https:\/\/www\.goofish\.com\/im\b/.test(await page.getCurrentUrl())) {
                await page.goto('https://www.goofish.com/im');
            }
        }
        await page.wait(2);
        if (rank > 0) {
            requireClickResult(await page.evaluate(buildClickInboxConversationEvaluate(rank - 1)), 'messages rank click');
            await page.wait(2);
        }
        const state = requireEvaluateObject(await page.evaluate(buildExtractChatStateEvaluate(limit)), 'messages');
        if (state?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu messages requires a logged-in browser session');
        }
        if (!Array.isArray(state.messages)) {
            throw new CommandExecutionError('Xianyu messages returned malformed message list');
        }
        const messages = state.messages;
        if (!messages.length) {
            throw new EmptyResultError('xianyu messages', 'No visible messages were found in this Xianyu conversation');
        }
        return messages.slice(-limit).map((message, index) => ({
            index: index + 1,
            peer_name: state.peer_name || '',
            item_title: state.item_title || '',
            message: message.text || '',
            item_id: itemId,
            peer_user_id: userId,
            url: url || '',
        }));
    },
});

export const __test__ = {
    buildChatUrl,
    buildExtractChatStateEvaluate,
    normalizeLimit,
    normalizeRank,
};
