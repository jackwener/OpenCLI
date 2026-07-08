import { ArgumentError, AuthRequiredError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildChatUrl, buildClickInboxConversationEvaluate, buildExtractChatStateEvaluate, buildSendMessageEvaluate, normalizeRank, requireClickResult, requireEvaluateObject, requireText } from './im.js';
import { normalizeNumericId } from './utils.js';

cli({
    site: 'xianyu',
    name: 'reply',
    access: 'write',
    description: '回复指定闲鱼私信会话',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'item_id', positional: true, help: '闲鱼商品 item_id' },
        { name: 'user_id', positional: true, help: '聊一聊对方的 user_id / peerUserId' },
        { name: 'text', required: true, help: 'Message text to send' },
        { name: 'rank', type: 'int', default: 0, help: 'Conversation rank from xianyu inbox; clicks the visible row instead of requiring IDs' },
    ],
    columns: ['status', 'peer_name', 'item_title', 'price', 'location', 'message'],
    func: async (page, kwargs) => {
        const hasItemId = kwargs.item_id != null && kwargs.item_id !== '';
        const hasUserId = kwargs.user_id != null && kwargs.user_id !== '';
        const rank = normalizeRank(kwargs.rank);
        if (rank > 0 && (hasItemId || hasUserId)) {
            throw new ArgumentError('xianyu reply accepts either item_id/user_id or --rank, not both');
        }
        if (rank === 0 && hasItemId !== hasUserId) {
            throw new ArgumentError('xianyu reply requires both item_id and user_id, or --rank from xianyu inbox');
        }
        if (rank === 0 && !hasItemId && !hasUserId) {
            throw new ArgumentError('xianyu reply requires item_id/user_id or --rank from xianyu inbox');
        }
        const hasIds = hasItemId && hasUserId;
        const itemId = hasIds ? normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192') : '';
        const userId = hasIds ? normalizeNumericId(kwargs.user_id, 'user_id', '3650092411') : '';
        const text = requireText(kwargs.text, 'xianyu reply --text');
        const url = hasIds ? buildChatUrl(itemId, userId) : '';
        if (hasIds) {
            await page.goto(url);
        } else {
            if (!page.getCurrentUrl || !/https:\/\/www\.goofish\.com\/im\b/.test(await page.getCurrentUrl())) {
                await page.goto('https://www.goofish.com/im');
            }
        }
        await page.wait(2);
        if (rank > 0) {
            requireClickResult(await page.evaluate(buildClickInboxConversationEvaluate(rank - 1)), 'reply rank click');
            await page.wait(2);
        }
        const state = requireEvaluateObject(await page.evaluate(buildExtractChatStateEvaluate()), 'reply');
        if (state?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu reply requires a logged-in browser session');
        }
        if (!state?.can_input) {
            throw selectorError('闲鱼聊天输入框', '未找到可用的聊天输入框，请确认该会话页已正确加载');
        }
        const sent = requireEvaluateObject(await page.evaluate(buildSendMessageEvaluate(text)), 'reply send');
        if (!sent?.ok) {
            throw new CommandExecutionError(`Xianyu reply did not observe the sent message: ${sent?.reason || 'unknown-reason'}`);
        }
        await page.wait(1);
        return [{
            status: 'sent',
            peer_name: state.peer_name || '',
            item_title: state.item_title || '',
            price: state.price || '',
            location: state.location || '',
            message: text,
            peer_user_id: userId,
            item_id: itemId,
            url: url || '',
            item_url: state.item_url || '',
        }];
    },
});

export const __test__ = {
    buildChatUrl,
    buildSendMessageEvaluate,
};
