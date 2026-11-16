import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { collectHistory, contentObject, isoTime, requireObject } from '../_shared/private-messages.js';

const HOST = 'www.douyin.com';
const CONVERSATION_ID = /^0:1:\d+:\d+$/;

export function parsePrivateTarget(value) {
    const target = String(value ?? '').trim();
    if (CONVERSATION_ID.test(target) || /^\d+$/.test(target)) return target;
    throw new ArgumentError('douyin messages requires an exact private conversation ID or numeric user ID from inbox (not a nickname or sec_uid)');
}

/**
 * Read the IM React provider, not numeric webpack modules or a reverse-engineered protobuf API.
 * Every operation uses only the site's existing read/load methods. No thread selection or mark-read.
 */
export function buildImEvaluate(action, params = {}) {
    return `(async () => {
        const action = ${JSON.stringify(action)};
        const args = ${JSON.stringify(params)};
        const locate = () => {
            const root = document.querySelector('#imSaasContainerId');
            if (!root) return null;
            const key = Object.keys(root).find(key => key.startsWith('__reactFiber'));
            let fiber = key ? root[key] : null;
            for (let depth = 0; fiber && depth < 60; depth += 1, fiber = fiber.return) {
                const value = fiber.memoizedProps?.value;
                if (value?.imSdkService?.imSdkManager?.getImSdkInstance && value?.store?.usersInfoStore) return value;
            }
            return null;
        };
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        try {
            let app = locate();
            if (action === 'ready') {
                const deadline = Date.now() + 15000;
                while (Date.now() < deadline) {
                    app = locate();
                    if (app && app.imSdkService.imSdkManager.getImSdkInstance()?.getConversationList
                        && !app.store.conversationStore.isLoading) return { state: 'ready' };
                    const modal = document.querySelector('[class*="login-mask"], [class*="LoginMask"], [class*="login-modal"]');
                    if (modal && modal.getBoundingClientRect().width > 0) return { state: 'auth' };
                    await sleep(250);
                }
                return { state: 'timeout' };
            }
            if (!app) return { state: 'error', error: 'IM React provider unavailable' };
            const sdk = app.imSdkService.imSdkManager.getImSdkInstance();
            const store = app.store.conversationStore;
            const list = () => sdk.getConversationList({ filter: conversation => conversation.type === 1 });
            const serializeMessage = message => ({
                serverId: message.serverId,
                threadId: message.conversationId,
                authorId: String(message.sender),
                fromMe: message.isFromMe,
                kind: message.type,
                body: message.content,
                timeMs: message.createdAt?.getTime?.(),
                recalled: message.isRecalled,
                shown: message.visible,
                position: String(message.indexInConversation),
            });
            const serializeConversation = conversation => {
                const user = app.store.usersInfoStore.usersInfoMap.get(conversation.toParticipantUserId);
                const last = conversation.lastVisibleMessage;
                return {
                    threadId: conversation.id,
                    peerId: conversation.toParticipantUserId,
                    displayName: user?.remark_name || user?.nickname || null,
                    secUid: user?.sec_uid || null,
                    lastBody: last?.content ?? null,
                    timeMs: last?.createdAt?.getTime?.() ?? conversation.updatedAt?.getTime?.() ?? null,
                    unread: conversation.unreadCount,
                    latestPosition: String(conversation.lastMessageIndex),
                };
            };
            if (action === 'list' || action === 'find') {
                // Legacy loadMoreFromInitLink returns request SUCCESS, not history hasMore.
                // The actual completion flag lives in the SDK's init-link nextParams.
                const isNextSdk = app.imSdkService.imSdkManager.useWebImSdkNext;
                const initLink = sdk.plugins?.find(plugin => plugin.initLinkInstance)?.initLinkInstance;
                const hasMore = () => {
                    const value = isNextSdk ? store.hasMore : initLink?.nextParams?.hasMore;
                    if (typeof value !== 'boolean') throw Error('Conversation completion flag unavailable');
                    return value;
                };
                const signature = () => sdk.getConversationList().map(conversation => conversation.id).sort().join('|')
                    + (isNextSdk ? '' : '|' + initLink?.nextParams?.page + '|' + String(initLink?.nextParams?.versionForNextQuery));
                let conversations = list();
                const eligibleCount = () => args.unreadOnly ? conversations.reduce((count, conversation) => {
                    if (!Number.isSafeInteger(conversation.unreadCount) || conversation.unreadCount < 0) throw Error('Invalid unread count');
                    return count + (conversation.unreadCount > 0 ? 1 : 0);
                }, 0) : conversations.length;
                let matched = conversations.find(conversation => conversation.id === args.target || conversation.toParticipantUserId === args.target);
                for (let attempt = 0; attempt < 100
                    && (action === 'find' ? !matched : eligibleCount() < args.limit) && hasMore(); attempt += 1) {
                    const before = signature();
                    if (isNextSdk) await store.loadMoreConversations();
                    else if (await app.imSdkService.conversationListManager.loadMoreConversations() !== true) {
                        return { state: 'error', error: 'Conversation history request failed' };
                    }
                    await sleep(300);
                    conversations = list();
                    matched = conversations.find(conversation => conversation.id === args.target || conversation.toParticipantUserId === args.target);
                    if (signature() === before && hasMore()) {
                        return { state: 'error', error: 'Conversation pagination stalled while hasMore remained true' };
                    }
                }
                if (action === 'find') return matched
                    ? { state: 'ok', chat: serializeConversation(matched) }
                    : hasMore() ? { state: 'error', error: 'Conversation page safety bound reached' } : { state: 'not-found' };
                if (eligibleCount() < args.limit && hasMore()) return { state: 'error', error: 'Conversation page safety bound reached' };
                return { state: 'ok', chats: conversations.filter(conversation => !args.unreadOnly || conversation.unreadCount > 0).map(serializeConversation) };
            }
            if (action === 'history') {
                const conversation = sdk.getConversation({ conversationId: args.threadId });
                if (!conversation || conversation.type !== 1 || conversation.id !== args.threadId) {
                    return { state: 'error', error: 'Private conversation identity changed' };
                }
                const result = await sdk.getMessagesByConversation({ conversation, cursor: args.cursor, limit: 50 });
                if (!result || !Array.isArray(result.messages)) return { state: 'error', error: 'Missing SDK history response' };
                return {
                    state: 'ok',
                    items: result.messages.map(serializeMessage),
                    hasMore: result.hasMore,
                    nextCursor: result.cursor == null ? null : String(result.cursor),
                };
            }
            return { state: 'error', error: 'Unsupported read operation' };
        } catch (error) {
            return { state: 'error', error: String(error?.message || error?.msg || error), auth: /login|unauthorized|登录|未登录/i.test(String(error?.message || error?.msg || '')) };
        }
    })()`;
}

export async function evaluateIm(page, action, params) {
    const result = requireObject(await page.evaluate(buildImEvaluate(action, params)), 'Douyin IM');
    if (result.state === 'auth' || result.auth) throw new AuthRequiredError(HOST, 'Douyin private messages require an active www.douyin.com login.');
    if (result.state === 'timeout') throw new TimeoutError('Douyin IM initialization', 15, 'Open Douyin in Chrome and check that private messages are available.');
    if (result.state === 'not-found') throw new EmptyResultError('douyin messages', 'No existing private conversation matched this ID.');
    if (result.state !== 'ok' && result.state !== 'ready') throw new CommandExecutionError(`Douyin IM failed: ${result.error || 'unexpected response'}`);
    return result;
}

export async function openPrivateMessages(page) {
    await page.goto(`https://${HOST}/`);
    await evaluateIm(page, 'ready');
}

export function validatePrivateChat(chat) {
    if (!chat || typeof chat.threadId !== 'string' || !CONVERSATION_ID.test(chat.threadId)
        || typeof chat.peerId !== 'string' || !/^\d+$/.test(chat.peerId)
        || !chat.threadId.split(':').slice(2).includes(chat.peerId)
        || typeof chat.latestPosition !== 'string' || !/^\d+$/.test(chat.latestPosition)) {
        throw new CommandExecutionError('Douyin IM returned a malformed private conversation');
    }
    return chat;
}

export function previewContent(body) {
    if (body == null) return null;
    const parsed = contentObject(body, 'Douyin IM');
    for (const key of ['text', 'content_title', 'description', 'display_name', 'tips', 'hint_content']) {
        if (typeof parsed[key] === 'string' && parsed[key]) return parsed[key];
    }
    return null;
}

export function projectInboxChat(chat, index) {
    validatePrivateChat(chat);
    if (!Number.isSafeInteger(chat.unread) || chat.unread < 0) throw new CommandExecutionError('Douyin inbox returned an invalid unread count');
    return {
        rank: index + 1,
        conversation_id: chat.threadId,
        user_id: chat.peerId,
        nickname: chat.displayName,
        last_message: previewContent(chat.lastBody),
        updated_at: chat.timeMs == null ? null : isoTime(chat.timeMs, 'Douyin inbox'),
        unread_count: chat.unread,
        profile_url: chat.secUid ? `https://${HOST}/user/${encodeURIComponent(chat.secUid)}` : null,
    };
}

export function projectPrivateMessage(raw, chat) {
    if (!raw || raw.threadId !== chat.threadId || typeof raw.shown !== 'boolean') throw new CommandExecutionError('Douyin history returned a mismatched or malformed message');
    if (!raw.shown) return null; // SDK control events are not visible conversation history.
    if (typeof raw.serverId !== 'string' || !/^\d+$/.test(raw.serverId)
        || typeof raw.authorId !== 'string' || !/^\d+$/.test(raw.authorId)
        || typeof raw.fromMe !== 'boolean' || typeof raw.recalled !== 'boolean' || !Number.isSafeInteger(raw.kind)) {
        throw new CommandExecutionError('Douyin history returned a malformed visible message');
    }
    const body = contentObject(raw.body, 'Douyin history');
    const kinds = { 1: 'system', 5: 'sticker', 7: 'text', 8: 'share', 17: 'voice', 25: 'profile', 27: 'image', 77: 'share', 110: 'system' };
    return {
        orderKey: raw.position,
        conversation_id: chat.threadId,
        message_id: raw.serverId,
        sender_id: raw.authorId,
        is_self: raw.fromMe,
        type: kinds[raw.kind] ?? `unknown:${raw.kind}`,
        text: previewContent(raw.body) ?? (typeof body.ai_audio_text === 'string' ? body.ai_audio_text : null),
        created_at: isoTime(raw.timeMs, 'Douyin history'),
        revoked: raw.recalled,
        raw_content: raw.body,
    };
}

export async function readPrivateHistory(page, chat, options) {
    const upperBound = BigInt(chat.latestPosition);
    return collectHistory({
        label: 'douyin messages', options, cursor: (upperBound + 1n).toString(),
        fetchPage: async cursor => {
            const result = await evaluateIm(page, 'history', { threadId: chat.threadId, cursor });
            if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean'
                || (result.hasMore && (typeof result.nextCursor !== 'string' || !/^\d+$/.test(result.nextCursor)
                    || BigInt(result.nextCursor) >= BigInt(cursor)))) {
                throw new CommandExecutionError('Douyin SDK returned an invalid history cursor or completion flag');
            }
            if (result.items.some(item => typeof item.position !== 'string' || !/^\d+$/.test(item.position)
                || BigInt(item.position) >= BigInt(cursor) || BigInt(item.position) > upperBound)) {
                throw new CommandExecutionError('Douyin SDK returned history outside the requested snapshot');
            }
            return result;
        },
        project: item => projectPrivateMessage(item, chat),
        pause: () => page.wait(0.3),
    });
}
