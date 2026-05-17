import { AuthRequiredError, EmptyResultError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    buildChatUrl,
    buildClickInboxConversationEvaluate,
    buildExtractChatStateEvaluate,
    DEFAULT_MESSAGE_LIMIT,
    MAX_MESSAGE_LIMIT,
    normalizeLimit,
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
        const hasIds = kwargs.item_id != null && kwargs.item_id !== '' && kwargs.user_id != null && kwargs.user_id !== '';
        const itemId = hasIds ? normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192') : '';
        const userId = hasIds ? normalizeNumericId(kwargs.user_id, 'user_id', '3650092411') : '';
        const rank = Number(kwargs.rank || 0);
        const limit = normalizeLimit(kwargs.limit, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT);
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
        if (Number.isInteger(rank) && rank > 0) {
            const clicked = await page.evaluate(buildClickInboxConversationEvaluate(rank - 1));
            if (clicked?.ok) await page.wait(2);
        }
        let state = await page.evaluate(buildExtractChatStateEvaluate(limit));
        if (state?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu messages requires a logged-in browser session');
        }
        if (!Array.isArray(state?.messages) || state.messages.length === 0) {
            const clicked = await page.evaluate(buildClickInboxConversationEvaluate(0));
            if (clicked?.ok) {
                await page.wait(2);
                state = await page.evaluate(buildExtractChatStateEvaluate(limit));
            }
        }
        if (!state?.can_input && !Array.isArray(state?.messages)) {
            throw selectorError('闲鱼聊天消息列表', '未找到可用的聊天消息列表，请确认该会话页已正确加载');
        }
        const messages = Array.isArray(state?.messages) ? state.messages : [];
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
};
