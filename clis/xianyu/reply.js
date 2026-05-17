import { AuthRequiredError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildChatUrl, buildClickInboxConversationEvaluate, buildExtractChatStateEvaluate, buildSendMessageEvaluate, requireText } from './im.js';
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
        const hasIds = kwargs.item_id != null && kwargs.item_id !== '' && kwargs.user_id != null && kwargs.user_id !== '';
        const itemId = hasIds ? normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192') : '';
        const userId = hasIds ? normalizeNumericId(kwargs.user_id, 'user_id', '3650092411') : '';
        const rank = Number(kwargs.rank || 0);
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
        if (Number.isInteger(rank) && rank > 0) {
            const clicked = await page.evaluate(buildClickInboxConversationEvaluate(rank - 1));
            if (clicked?.ok) await page.wait(2);
        }
        let state = await page.evaluate(buildExtractChatStateEvaluate());
        if (state?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu reply requires a logged-in browser session');
        }
        if (!state?.can_input) {
            const clicked = await page.evaluate(buildClickInboxConversationEvaluate(0));
            if (clicked?.ok) {
                await page.wait(2);
                state = await page.evaluate(buildExtractChatStateEvaluate());
            }
        }
        if (!state?.can_input) {
            throw selectorError('闲鱼聊天输入框', '未找到可用的聊天输入框，请确认该会话页已正确加载');
        }
        const sent = await page.evaluate(buildSendMessageEvaluate(text));
        if (!sent?.ok) {
            throw selectorError('闲鱼发送按钮', `消息发送失败：${sent?.reason || 'unknown-reason'}`);
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
