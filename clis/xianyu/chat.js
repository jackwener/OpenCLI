import { AuthRequiredError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildChatUrl, buildExtractChatStateEvaluate, buildSendMessageEvaluate, requireEvaluateObject } from './im.js';
import { normalizeNumericId } from './utils.js';

cli({
    site: 'xianyu',
    name: 'chat',
    access: 'write',
    description: '打开闲鱼聊一聊会话，并可选发送消息',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'item_id', required: true, positional: true, help: '闲鱼商品 item_id' },
        { name: 'user_id', required: true, positional: true, help: '聊一聊对方的 user_id / peerUserId' },
        { name: 'text', help: 'Message to send after opening the chat' },
    ],
    columns: ['status', 'peer_name', 'item_title', 'price', 'location', 'message'],
    func: async (page, kwargs) => {
        const itemId = normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192');
        const userId = normalizeNumericId(kwargs.user_id, 'user_id', '3650092411');
        const url = buildChatUrl(itemId, userId);
        const text = String(kwargs.text || '').trim();
        await page.goto(url);
        await page.wait(2);
        const state = requireEvaluateObject(await page.evaluate(buildExtractChatStateEvaluate()), 'chat');
        if (state?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu chat requires a logged-in browser session');
        }
        if (!state?.can_input) {
            throw selectorError('闲鱼聊天输入框', '未找到可用的聊天输入框，请确认该会话页已正确加载');
        }
        if (!text) {
            return [{
                status: 'ready',
                peer_name: state.peer_name || '',
                item_title: state.item_title || '',
                price: state.price || '',
                location: state.location || '',
                message: (state.visible_messages || []).slice(-1)[0] || '',
                peer_user_id: userId,
                item_id: itemId,
                url,
                item_url: state.item_url || '',
            }];
        }
        const sent = requireEvaluateObject(await page.evaluate(buildSendMessageEvaluate(text)), 'chat send');
        if (!sent?.ok) {
            throw new CommandExecutionError(`Xianyu chat did not observe the sent message: ${sent?.reason || 'unknown-reason'}`);
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
            url,
            item_url: state.item_url || '',
        }];
    },
});

export const __test__ = {
    normalizeNumericId,
    buildChatUrl,
    buildExtractChatStateEvaluate,
    buildSendMessageEvaluate,
};
