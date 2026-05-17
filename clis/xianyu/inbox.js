import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    buildClickInboxConversationEvaluate,
    buildExtractInboxEvaluate,
    buildInboxUrl,
    buildReadCurrentConversationUrlEvaluate,
    DEFAULT_INBOX_LIMIT,
    MAX_INBOX_LIMIT,
    normalizeLimit,
} from './im.js';

cli({
    site: 'xianyu',
    name: 'inbox',
    access: 'read',
    description: '列出闲鱼最近私信会话',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_INBOX_LIMIT, help: 'Number of conversations to return' },
        { name: 'unread-only', type: 'bool', default: false, help: 'Return only conversations with unread messages' },
        { name: 'resolve-ids', type: 'bool', default: false, help: 'Click each visible conversation to resolve item_id and peer_user_id from the chat URL' },
    ],
    columns: ['rank', 'peer_name', 'peer_user_id', 'item_id', 'item_title', 'price', 'last_message', 'unread', 'unread_count', 'url'],
    func: async (page, kwargs) => {
        const limit = normalizeLimit(kwargs.limit, DEFAULT_INBOX_LIMIT, MAX_INBOX_LIMIT);
        const unreadOnly = Boolean(kwargs['unread-only']);
        const resolveIds = Boolean(kwargs['resolve-ids']);
        let currentUrl = '';
        if (page.getCurrentUrl) {
            try {
                currentUrl = await page.getCurrentUrl();
            } catch {
                currentUrl = '';
            }
        }
        if (!/https:\/\/www\.goofish\.com\/im\b/.test(currentUrl)) {
            await page.goto(buildInboxUrl());
        }
        await page.wait(4);
        const payload = await page.evaluate(buildExtractInboxEvaluate(limit));
        if (payload?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu inbox requires a logged-in browser session');
        }
        if (payload?.blocked) {
            throw new EmptyResultError('xianyu inbox', 'Xianyu inbox is blocked by verification or risk control');
        }
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!items.length && !payload?.empty) {
            throw new EmptyResultError('xianyu inbox', 'No Xianyu inbox conversations were found');
        }
        let conversations = items.slice(0, limit);
        if (unreadOnly) {
            conversations = conversations.filter((item) => Boolean(item.unread));
        }
        if (resolveIds) {
            for (const item of conversations) {
                if (item.item_id && item.peer_user_id) continue;
                const rowIndex = Number(item.row_index);
                if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
                const clicked = await page.evaluate(buildClickInboxConversationEvaluate(rowIndex));
                if (!clicked?.ok) continue;
                await page.wait(1);
                const current = await page.evaluate(buildReadCurrentConversationUrlEvaluate());
                item.item_id = current?.item_id || item.item_id || '';
                item.peer_user_id = current?.peer_user_id || item.peer_user_id || '';
                item.url = current?.url || item.url || '';
            }
        }
        return conversations.map((item, index) => ({
            rank: index + 1,
            peer_name: item.peer_name || '',
            peer_user_id: item.peer_user_id || '',
            item_id: item.item_id || '',
            item_title: item.item_title || '',
            price: item.price || '',
            last_message: item.last_message || '',
            unread: Boolean(item.unread),
            unread_count: Number(item.unread_count || 0),
            url: item.url || '',
        }));
    },
});

export const __test__ = {
    buildInboxUrl,
    buildExtractInboxEvaluate,
    normalizeLimit,
};
