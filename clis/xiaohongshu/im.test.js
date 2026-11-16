import { describe, expect, it, vi } from 'vitest';
import { command as inbox } from './inbox.js';
import { command as messages } from './messages.js';
import { fetchImJson, parsePrivateUserId, projectPrivateMessage } from './im.js';
import { INBOX_COLUMNS, MESSAGE_COLUMNS } from '../_shared/private-messages.js';

const self = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const peer = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const other = 'cccccccccccccccccccccccc';
const chat = {
    user_id: self, chat_user_id: peer, start_store_id: 0, max_store_id: 5,
    last_msg_time: 1700000000000, last_msg_content: 'Synthetic preview', info: { nickname: 'Synthetic user' },
};
const message = (storeId, overrides = {}) => ({
    store_id: storeId, id: `message-${storeId}`, sender_id: self, receiver_id: peer,
    content: JSON.stringify({ content_type: 1, content: `Synthetic ${storeId}` }),
    created_at: 1700000000000 + storeId, revoked: false, group_chat: false, ...overrides,
});
const envelope = data => ({ status: 200, json: { success: true, code: 0, data } });
const chatPage = (chats = [chat], overrides = {}) => envelope({ chats, total: chats.length, next_ts: -1, ...overrides });
const historyPage = items => envelope({ result: { success: true, code: 0 }, out_message_list: items });
const pageMock = (...payloads) => ({
    goto: vi.fn().mockResolvedValue(), wait: vi.fn().mockResolvedValue(),
    evaluate: vi.fn().mockImplementation(async () => payloads.shift()),
});

describe('xiaohongshu private conversation identifiers', () => {
    it('accepts IDs and exact trusted profile URLs, preserving stable selection', () => {
        expect(parsePrivateUserId(peer.toUpperCase())).toBe(peer);
        expect(parsePrivateUserId(`https://www.xiaohongshu.com/user/profile/${peer}?xsec_token=example`)).toBe(peer);
    });
    it.each(['', 'Nickname', 'javascript:alert(1)', `https://evil.example/user/profile/${peer}`, `https://www.xiaohongshu.com.evil.example/user/profile/${peer}`, `https://www.xiaohongshu.com/user/profile/${peer}/notes`])('rejects invalid or spoofed target %s', value => {
        expect(() => parsePrivateUserId(value)).toThrow();
    });
});

describe('xiaohongshu inbox', () => {
    it('returns private conversations with exact IDs and zero unread counts', async () => {
        const page = pageMock(chatPage(), envelope({ user_chat_unread_counts: { [peer]: 0 } }));
        const rows = await inbox.func(page, {});
        expect(Object.keys(rows[0])).toEqual(INBOX_COLUMNS);
        expect(rows[0]).toMatchObject({ conversation_id: peer, nickname: 'Synthetic user', unread_count: 0 });
        expect(page.goto).toHaveBeenCalledWith('https://www.xiaohongshu.com/chat');
        const scripts = page.evaluate.mock.calls.map(([code]) => code).join('\n');
        expect(scripts).toContain('/api/im/web/v3/chats');
        expect(scripts).not.toContain('messages/read');
        expect(scripts).not.toContain('.click(');
    });
    it('paginates and deduplicates when more conversations are requested', async () => {
        const page = pageMock(
            chatPage([chat], { total: 2, next_ts: 1700000000000 }),
            chatPage([chat, { ...chat, chat_user_id: other }], { total: 2 }),
            envelope({ user_chat_unread_counts: { [peer]: 0, [other]: 2 } }),
        );
        const rows = await inbox.func(page, { limit: 2 });
        expect(rows).toHaveLength(2);
        expect(page.evaluate.mock.calls[1][0]).toContain('page=1');
    });
    it('fails on stalled pagination, malformed chat metadata and missing unread counts', async () => {
        const stalled = chatPage([chat], { total: 2, next_ts: 100 });
        await expect(inbox.func(pageMock(stalled, stalled), { limit: 2 })).rejects.toThrow('stalled');
        await expect(inbox.func(pageMock(chatPage([{ ...chat, info: null }])), {})).rejects.toThrow('malformed');
        await expect(inbox.func(pageMock(chatPage(), envelope({ user_chat_unread_counts: {} })), {})).rejects.toThrow('unread count');
    });
    it('reports empty inbox explicitly', async () => {
        await expect(inbox.func(pageMock(chatPage([])), {})).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
});

describe('xiaohongshu unread filtering and incremental messages', () => {
    it('scans beyond read conversations before applying the matching limit', async () => {
        const page = pageMock(
            envelope({ user_chat_unread_counts: { [peer]: 0, [other]: 2 } }),
            chatPage([chat], { total: 2, next_ts: 100 }),
            chatPage([{ ...chat, chat_user_id: other }], { total: 2 }),
        );
        const rows = await inbox.func(page, { unread: true, limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ user_id: other, unread_count: 2 });
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate.mock.calls[2][0]).toContain('page=1');
    });
    it('distinguishes verified no-unread from missing unread metadata', async () => {
        await expect(inbox.func(pageMock(envelope({ user_chat_unread_counts: { [peer]: 0 } }), chatPage()), { unread: true })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(inbox.func(pageMock(envelope({ user_chat_unread_counts: {} }), chatPage()), { unread: true })).rejects.toThrow('unread count');
    });
    it('reads after a checkpoint across pages and emits the oldest new N first', async () => {
        const page = pageMock(chatPage(), historyPage([message(5), message(4)]), historyPage([message(3), message(2), message(1)]));
        expect((await messages.func(page, { target: peer, 'after-message': 'message-2', limit: 2 })).map(row => row.message_id)).toEqual(['message-3', 'message-4']);
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });
});

describe('xiaohongshu messages', () => {
    it('returns the latest N in conversation order and matches declared columns', async () => {
        const page = pageMock(chatPage(), historyPage([message(5), message(4), message(3)]));
        const rows = await messages.func(page, { target: peer, limit: 2 });
        expect(rows.map(item => item.message_id)).toEqual(['message-4', 'message-5']);
        expect(Object.keys(rows[0])).toEqual(MESSAGE_COLUMNS);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
    it('fetches all available history and never asks for last_id=0 (which would restart latest)', async () => {
        const page = pageMock(chatPage(), historyPage([message(5), message(4), message(3)]), historyPage([message(2), message(1)]));
        const rows = await messages.func(page, { target: peer, all: true });
        expect(rows.map(item => item.message_id)).toEqual(['message-1', 'message-2', 'message-3', 'message-4', 'message-5']);
        const scripts = page.evaluate.mock.calls.map(([code]) => code).join('\n');
        expect(scripts).toContain('last_id=5');
        expect(scripts).toContain('last_id=2');
        expect(scripts).not.toContain('last_id=0');
        expect(scripts).not.toContain('messages/read');
    });
    it('honors the account history lower bound and store-ID gaps', async () => {
        const page = pageMock(chatPage([{ ...chat, start_store_id: 2 }]), historyPage([message(5), message(3)]));
        expect(await messages.func(page, { target: peer, all: true })).toHaveLength(2);
        expect(page.evaluate.mock.calls[1][0]).toContain('start_id=2');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
    it('preserves media, unknown message content and recall state rather than inventing text', () => {
        const raw = message(1, { revoked: true, content: JSON.stringify({ content_type: 999, image: { url: 'https://example.invalid/image' } }) });
        expect(projectPrivateMessage(raw, chat)).toMatchObject({ revoked: true, type: 'unknown:999', text: null, raw_content: raw.content });
    });
    it('rejects messages for a different recipient and malformed timestamps', () => {
        expect(() => projectPrivateMessage(message(1, { receiver_id: other }), chat)).toThrow('mismatched');
        expect(() => projectPrivateMessage(message(1, { group_chat: true }), chat)).toThrow('malformed');
        expect(() => projectPrivateMessage(message(1, { created_at: 0 }), chat)).toThrow('timestamp');
    });
    it('rejects cursor drift instead of falsely reporting complete history', async () => {
        const page = pageMock(chatPage(), historyPage([message(4)]), historyPage([message(4)]));
        await expect(messages.func(page, { target: peer, all: true })).rejects.toThrow('out-of-range');
    });
    it('rejects invalid options before touching the browser', async () => {
        const page = pageMock();
        await expect(messages.func(page, { target: peer, all: true, limit: 2 })).rejects.toThrow('--all');
        await expect(messages.func(page, { target: 'nickname' })).rejects.toThrow('user ID');
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('requires an existing exact private conversation', async () => {
        await expect(messages.func(pageMock(chatPage()), { target: other })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
    it('reports missing or empty history without returning fake rows', async () => {
        await expect(messages.func(pageMock(chatPage(), historyPage([])), { target: peer, all: true })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(messages.func(pageMock(chatPage(), envelope({})), { target: peer })).rejects.toThrow('out_message_list');
    });
});

describe('xiaohongshu private API error envelopes', () => {
    it.each([
        { status: 401, json: {} }, { status: 403, json: {} },
        { status: 200, json: { success: false, code: -100, msg: '未登录' } },
    ])('classifies login and verification failures', async payload => {
        await expect(fetchImJson(pageMock(payload), '/api/im/web/v3/chats')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });
    it('rejects API failures, bad JSON, missing data and request timeouts', async () => {
        await expect(fetchImJson(pageMock({ status: 500, error: 'non-JSON response' }), '/test')).rejects.toThrow('non-JSON');
        await expect(fetchImJson(pageMock(envelope({ result: { success: false, code: 10 } })), '/test')).rejects.toThrow('rejected');
        await expect(fetchImJson(pageMock({ status: 200, json: { success: false, code: 10 } }), '/test')).rejects.toThrow('failed');
        await expect(fetchImJson(pageMock({ status: 200, json: { success: true, code: 0 } }), '/test')).rejects.toThrow('malformed');
        await expect(fetchImJson(pageMock({ timedOut: true }), '/test')).rejects.toMatchObject({ code: 'TIMEOUT' });
    });
});
