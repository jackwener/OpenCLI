import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { collectHistory, contentObject, isoTime, requireObject } from '../_shared/private-messages.js';

const HOST = 'www.xiaohongshu.com';
const API = 'https://edith.xiaohongshu.com';
const USER_ID = /^[a-f0-9]{24}$/i;

export function parsePrivateUserId(value) {
    const raw = String(value ?? '').trim();
    if (USER_ID.test(raw)) return raw.toLowerCase();
    try {
        const url = new URL(raw);
        const match = url.pathname.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i);
        if (url.protocol === 'https:' && url.hostname === HOST && !url.username && !url.password && !url.port && match) return match[1].toLowerCase();
    } catch { /* A bare ID was already checked. */ }
    throw new ArgumentError('xiaohongshu messages requires a user ID from inbox or an exact Xiaohongshu profile URL');
}

/** Page-context GET only: do not call messages/read or open a thread (which marks it read). */
export async function fetchImJson(page, path, params = {}) {
    const url = new URL(path, API);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const payload = requireObject(await page.evaluate(`(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(${JSON.stringify(url.href)}, { credentials: 'include', signal: controller.signal });
            const body = await response.text();
            let json;
            try { json = JSON.parse(body); } catch { return { status: response.status, error: 'non-JSON response' }; }
            return { status: response.status, json };
        } catch (error) { return { error: String(error?.message || error), timedOut: controller.signal.aborted }; }
        finally { clearTimeout(timer); }
    })()`), 'Xiaohongshu private messages');
    if (payload.timedOut) throw new TimeoutError('Xiaohongshu IM request', 20);
    if (payload.status === 401 || payload.status === 403) throw new AuthRequiredError(HOST, 'Xiaohongshu private messages require an active web login.');
    if (payload.error) throw new CommandExecutionError(`Xiaohongshu IM request failed: ${payload.error}`);
    const body = requireObject(payload.json, 'Xiaohongshu IM API');
    if (payload.status !== 200 || body.success !== true || body.code !== 0) {
        if (body.code === -100 || /登录|登陆|login|auth|验证码|验证/i.test(String(body.msg || ''))) {
            throw new AuthRequiredError(HOST, 'Xiaohongshu private messages require login or manual verification.');
        }
        throw new CommandExecutionError(`Xiaohongshu IM API failed (HTTP ${payload.status}, code ${body.code})`);
    }
    const data = requireObject(body.data, 'Xiaohongshu IM API data');
    if (data.result && (data.result.success !== true || data.result.code !== 0)) {
        throw new CommandExecutionError(`Xiaohongshu IM API rejected the history request (code ${data.result.code})`);
    }
    return data;
}

export function validateChat(chat) {
    if (!chat || !USER_ID.test(chat.chat_user_id) || !USER_ID.test(chat.user_id) || chat.group_chat === true
        || !Number.isSafeInteger(chat.start_store_id) || chat.start_store_id < 0
        || !Number.isSafeInteger(chat.max_store_id) || chat.max_store_id < chat.start_store_id
        || !chat.info || typeof chat.info.nickname !== 'string') {
        throw new CommandExecutionError('Xiaohongshu IM returned a malformed private conversation');
    }
    return chat;
}

export async function getPrivateChats(page, { limit = 20, target, unreadCounts, skipNavigation = false } = {}) {
    if (!skipNavigation) await page.goto(`https://${HOST}/chat`);
    const chats = new Map();
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const data = await fetchImJson(page, '/api/im/web/v3/chats', { limit: 100, complete: true, page: pageNumber, source: 'pc' });
        if (!Array.isArray(data.chats) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.next_ts)) {
            throw new CommandExecutionError('Xiaohongshu IM returned a malformed conversation page');
        }
        const before = chats.size;
        for (const raw of data.chats) {
            const chat = validateChat(raw);
            if (!chats.has(chat.chat_user_id)) chats.set(chat.chat_user_id, chat);
        }
        if (target && chats.has(target)) return [chats.get(target)];
        const matching = [...chats.values()].filter(chat => {
            if (unreadCounts == null) return true;
            const count = unreadCounts[chat.chat_user_id];
            if (!Number.isSafeInteger(count) || count < 0) throw new CommandExecutionError('Xiaohongshu inbox is missing a valid unread count');
            return count > 0;
        });
        if ((!target && matching.length >= limit) || chats.size >= data.total || data.next_ts === -1) {
            if (target) throw new EmptyResultError('xiaohongshu messages', 'This user has no existing private conversation in inbox.');
            return matching.sort((a, b) => b.last_msg_time - a.last_msg_time).slice(0, limit);
        }
        if (chats.size === before) throw new CommandExecutionError('Xiaohongshu inbox pagination stalled');
        await page.wait(0.3);
    }
    throw new CommandExecutionError('Xiaohongshu inbox exceeded its conversation page safety bound');
}

export function projectInboxChat(chat, index, unreadCounts) {
    const unread = unreadCounts[chat.chat_user_id];
    if (!Number.isSafeInteger(unread) || unread < 0) throw new CommandExecutionError('Xiaohongshu inbox is missing a valid unread count');
    return {
        rank: index + 1,
        conversation_id: chat.chat_user_id,
        user_id: chat.chat_user_id,
        nickname: chat.info.nickname,
        last_message: typeof chat.last_msg_content === 'string' ? chat.last_msg_content : null,
        updated_at: isoTime(chat.last_msg_time, 'Xiaohongshu inbox'),
        unread_count: unread,
        profile_url: `https://${HOST}/user/profile/${chat.chat_user_id}`,
    };
}

export function projectPrivateMessage(raw, chat) {
    if (!raw || raw.group_chat !== false || !Number.isSafeInteger(raw.store_id) || raw.store_id < 1
        || typeof raw.id !== 'string' || typeof raw.revoked !== 'boolean'
        || !((raw.sender_id === chat.user_id && raw.receiver_id === chat.chat_user_id)
            || (raw.sender_id === chat.chat_user_id && raw.receiver_id === chat.user_id))) {
        throw new CommandExecutionError('Xiaohongshu history returned a malformed message or mismatched private recipient');
    }
    const body = contentObject(raw.content, 'Xiaohongshu history');
    if (!Number.isSafeInteger(body.content_type)) throw new CommandExecutionError('Xiaohongshu history is missing content_type');
    const kind = { 0: 'system', 1: 'text', 2: 'image', 3: 'voice', 4: 'video', 13: 'share' }[body.content_type] ?? `unknown:${body.content_type}`;
    return {
        orderKey: String(raw.store_id),
        conversation_id: chat.chat_user_id,
        message_id: raw.id,
        sender_id: raw.sender_id,
        is_self: raw.sender_id === chat.user_id,
        type: kind,
        text: typeof body.content === 'string' ? body.content : typeof body.front_chain === 'string' ? body.front_chain : null,
        created_at: isoTime(raw.created_at, 'Xiaohongshu history'),
        revoked: raw.revoked,
        raw_content: raw.content,
    };
}

export async function readPrivateHistory(page, chat, options) {
    if (chat.max_store_id <= chat.start_store_id) throw new EmptyResultError('xiaohongshu messages', 'This private conversation has no available history.');
    return collectHistory({
        label: 'xiaohongshu messages', options, cursor: chat.max_store_id,
        fetchPage: async (cursor) => {
            const data = await fetchImJson(page, '/api/im/web/messages/history', {
                chat_user_id: chat.chat_user_id, last_id: cursor, start_id: chat.start_store_id, limit: 30,
            });
            const items = data.out_message_list;
            if (!Array.isArray(items)) throw new CommandExecutionError('Xiaohongshu history is missing out_message_list');
            if (items.length === 0) return { items, hasMore: false };
            const positions = items.map(item => item.store_id);
            if (positions.some(value => !Number.isSafeInteger(value) || value < 1 || value > cursor || value <= chat.start_store_id)) {
                throw new CommandExecutionError('Xiaohongshu history returned out-of-range store IDs');
            }
            const nextCursor = Math.min(...positions) - 1;
            return { items, hasMore: nextCursor > chat.start_store_id, nextCursor };
        },
        project: item => projectPrivateMessage(item, chat),
        pause: () => page.wait(0.3),
    });
}
