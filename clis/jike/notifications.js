import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeJikeLimit, postJikeApi, requireJikeIdentity } from './utils.js';

const API_PATH = '/1.0/notifications/list';
const PAGE_SIZE = 20;
const DEFAULT_LIMIT = 20;
const MAX_PAGES = 50;

const TYPE_LABELS = {
    AVATAR_GREET: '弹了你的头像',
    LIKE_AVATAR: '弹了你的头像',
    USER_FOLLOWED: '关注了你',
    USER_SILENT_FOLLOWED: '关注了你',
    LIKE_PERSONAL_UPDATE: '赞了你的动态',
    LIKE_PERSONAL_UPDATE_COMMENT: '赞了你的评论',
    LIKE_STORY: '赞了你的故事',
    REPLIED_TO_PERSONAL_UPDATE_COMMENT: '回复了你的评论',
    REPLIED_TO_STORY_COMMENT: '回复了你的评论',
    COMMENT_PERSONAL_UPDATE: '评论了你的动态',
    COMMENT_AND_REPOST: '评论了你的动态',
    COMMENT_STORY: '评论了你的故事',
    PERSONAL_UPDATE_REPOSTED: '转发了你的动态',
    MENTION: '@了你',
    MENTION_FROM_UNFOLLOWED_USER: '@了你',
    SILENT_MENTION: '悄悄提到了你',
    ENDOW: '给你的动态赠送了礼物',
    USER_RESPECT: '夸了夸你🎉',
};

function resolveActionLabel(notification, actionItem) {
    if (typeof TYPE_LABELS[notification.type] === 'string') return TYPE_LABELS[notification.type];
    if (typeof actionItem.behavior === 'string' && actionItem.behavior.trim()) return actionItem.behavior.trim();
    const sourceType = String(actionItem.type || notification.actionType || notification.type || '').toUpperCase();
    if (sourceType.includes('LIKE')) return '赞了你';
    if (sourceType.includes('COMMENT')) return '评论了你';
    if (sourceType.includes('FOLLOW')) return '关注了你';
    if (sourceType.includes('REPOST')) return '转发了你';
    if (sourceType.includes('MENTION')) return '提到了你';
    if (sourceType.includes('REPLY')) return '回复了你';
    return notification.type;
}

function cleanContent(value) {
    return typeof value === 'string' ? value.replace(/\n/g, ' ').slice(0, 100) : '';
}

function mapNotification(notification) {
    if (!notification || typeof notification !== 'object' || typeof notification.id !== 'string' || !notification.id) {
        throw new CommandExecutionError('Jike notifications API returned a malformed notification');
    }
    if (typeof notification.type !== 'string' || !notification.type) {
        throw new CommandExecutionError('Jike notifications API returned a notification without a type');
    }
    const actionItem = notification.actionItem;
    if (!actionItem || typeof actionItem !== 'object' || Array.isArray(actionItem)) {
        throw new CommandExecutionError('Jike notifications API returned a malformed action item');
    }
    if (!Array.isArray(actionItem.users)) {
        throw new CommandExecutionError('Jike notifications API returned a malformed users list');
    }
    const names = actionItem.users.map((user) => {
        if (!user || typeof user !== 'object') {
            throw new CommandExecutionError('Jike notifications API returned a malformed user');
        }
        return typeof user.screenName === 'string' ? user.screenName : '';
    }).filter(Boolean);
    const referenceItem = notification.referenceItem;
    const referenceContent = referenceItem && typeof referenceItem === 'object' && !Array.isArray(referenceItem)
        ? referenceItem.content
        : '';
    const time = typeof notification.createdAt === 'string'
        ? notification.createdAt
        : (typeof notification.updatedAt === 'string' ? notification.updatedAt : '');
    return {
        type: resolveActionLabel(notification, actionItem),
        user: names.join('、'),
        content: cleanContent(actionItem.content || referenceContent),
        time,
    };
}

async function fetchNotificationsPage(page, loadMoreKey) {
    const body = await postJikeApi(page, API_PATH, {
        limit: PAGE_SIZE,
        ...(loadMoreKey ? { loadMoreKey } : {}),
    }, 'Jike notifications API');
    if (!body || typeof body !== 'object' || body.success === false || !Array.isArray(body.data)) {
        throw new CommandExecutionError(`Jike notifications API failed: ${String(body?.error || body?.message || 'malformed response')}`);
    }
    return body;
}

async function listNotifications(page, limit) {
    const rows = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let loadMoreKey = null;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
        const body = await fetchNotificationsPage(page, loadMoreKey);
        for (const notification of body.data) {
            const row = mapNotification(notification);
            if (seenIds.has(notification.id)) continue;
            seenIds.add(notification.id);
            rows.push(row);
            if (rows.length >= limit) return rows;
        }
        const next = body.loadMoreKey;
        if (next == null) {
            if (rows.length === 0) throw new EmptyResultError('jike notifications', 'No notifications found');
            return rows;
        }
        if (typeof next !== 'object' || Array.isArray(next)) {
            throw new CommandExecutionError('Jike notifications API returned a malformed pagination cursor');
        }
        const cursorKey = JSON.stringify(next);
        if (seenCursors.has(cursorKey)) {
            throw new CommandExecutionError('Jike notifications pagination returned a repeated cursor');
        }
        seenCursors.add(cursorKey);
        loadMoreKey = next;
    }
    throw new CommandExecutionError(`Jike notifications pagination exceeded ${MAX_PAGES} pages before satisfying --limit`);
}

cli({
    site: 'jike',
    name: 'notifications',
    access: 'read',
    description: '即刻通知',
    domain: 'web.okjike.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT },
    ],
    columns: ['type', 'user', 'content', 'time'],
    func: async (page, kwargs) => {
        const limit = normalizeJikeLimit(kwargs.limit, DEFAULT_LIMIT);
        await page.goto('https://web.okjike.com/notification');
        await requireJikeIdentity(page);
        return listNotifications(page, limit);
    },
});
