import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildWriteScript } from './write-im.js';
import { command as send } from './send.js';
import { command as open } from './conversation-open.js';
const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaa'; const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const doms = [];
afterEach(() => { vi.restoreAllMocks(); doms.splice(0).forEach(dom => dom.window.close()); });
function fixture(ack = true) {
    const dom = new JSDOM(`<div id="app"></div><div class="xhs-im-conv-item" data-conv-id="${userId}"></div><div class="xhs-im-view__main"><div class="xhs-im-input-bar-editor" contenteditable="true"></div></div>`, { url: 'https://www.xiaohongshu.com/chat', runScripts: 'outside-only' }); doms.push(dom);
    dom.window.setTimeout = callback => { callback(); return 1; };
    const row = dom.window.document.querySelector('.xhs-im-conv-item');
    const editor = dom.window.document.querySelector('[contenteditable]'); editor.getBoundingClientRect = () => ({ width: 100 });
    row.addEventListener('click', () => row.classList.add('xhs-im-conv-item--active'));
    const click = vi.spyOn(row, 'click');
    const chat = { chatId: userId, chatType: 2, maxStoreId: 10, isBlocked: false };
    const messages = []; const me = { userId: accountId, guest: false };
    const chats = { fetchChatInfo: vi.fn(async () => ({ data: { [userId]: {} } })), getChatModel: vi.fn(() => chat) };
    const messageStore = { getMessageList: vi.fn(() => messages) };
    const nativeSend = vi.fn(() => {
        const text = editor.textContent;
        messages.push({ uuid: 'client-uuid', messageId: ack ? 'server-message-id' : 'client-uuid', senderId: accountId, chatId: userId, isGroupChat: false, contentType: 1, storeId: ack ? 11 : 0, getParsedContent: () => ({ text }) });
    });
    editor.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) nativeSend(); });
    const pinia = { _s: new Map([['user', { userInfo: me }], ['chatData', chats], ['messageData', messageStore]]) };
    dom.window.document.querySelector('#app').__vue_app__ = { config: { globalProperties: { $pinia: pinia } } };
    return { dom, row, editor, click, chat, chats, me, messages, nativeSend, run: args => dom.window.eval(buildWriteScript(args)) };
}
const args = { operation: 'send', accountId, userId, conversationId: userId, revision: '10', text: 'Synthetic <literal> text', expiresAt: Date.now() + 600000 };

describe('xiaohongshu native private chat writes', () => {
    it('preflights even a new author without selecting a thread or sending', async () => {
        const f = fixture();
        expect(await f.run({ operation: 'probe', userId })).toMatchObject({ accountId, userId, conversationId: userId, revision: '10' });
        expect(f.chats.fetchChatInfo).toHaveBeenCalledWith(userId);
        expect(f.click).not.toHaveBeenCalled(); expect(f.nativeSend).not.toHaveBeenCalled();
    });
    it('opens a verified native chat locally without pretending server creation or sending', async () => {
        const f = fixture();
        expect((await f.run({ ...args, operation: 'conversation-open' })).status).toBe('opened');
        expect(f.click).toHaveBeenCalledTimes(1); expect(f.nativeSend).not.toHaveBeenCalled();
    });
    it('dispatches exactly one native Enter and verifies an acknowledged server ID/storage position', async () => {
        const f = fixture();
        expect(await f.run(args)).toMatchObject({ status: 'sent', messageId: 'server-message-id' });
        expect(f.nativeSend).toHaveBeenCalledTimes(1);
        expect(f.editor.querySelector('literal')).toBeNull();
        expect(f.editor.textContent).toBe(args.text);
    });
    it('never treats a local UUID or pending message as sent and never retries', async () => {
        const f = fixture(false);
        expect((await f.run(args)).status).toBe('unknown');
        expect(f.nativeSend).toHaveBeenCalledTimes(1);
    });
    it('blocks account, recipient and latest-message changes before native send', async () => {
        const account = fixture(); account.me.userId = 'cccccccccccccccccccccccc';
        await expect(account.run(args)).rejects.toThrow('Account changed'); expect(account.nativeSend).not.toHaveBeenCalled();
        const recipient = fixture(); recipient.chat.chatId = 'cccccccccccccccccccccccc';
        await expect(recipient.run(args)).rejects.toThrow('identity mismatch'); expect(recipient.nativeSend).not.toHaveBeenCalled();
        const latest = fixture(); latest.chat.maxStoreId = 12;
        await expect(latest.run(args)).rejects.toThrow('context changed'); expect(latest.nativeSend).not.toHaveBeenCalled();
    });
    it('does not overwrite a previous draft and respects expired approval', async () => {
        const draft = fixture(); draft.editor.textContent = 'Existing synthetic draft';
        await expect(draft.run(args)).rejects.toThrow('overwrite'); expect(draft.nativeSend).not.toHaveBeenCalled();
        const expired = fixture(); await expect(expired.run({ ...args, expiresAt: 0 })).rejects.toThrow('expired'); expect(expired.click).not.toHaveBeenCalled();
    });
    it('rejects ambiguous target rows, blocked users and unavailable metadata', async () => {
        const duplicate = fixture(); duplicate.row.parentNode.appendChild(duplicate.row.cloneNode(true));
        await expect(duplicate.run(args)).rejects.toThrow('ambiguous');
        const blocked = fixture(); blocked.chat.isBlocked = true;
        await expect(blocked.run(args)).rejects.toThrow('unavailable');
        const missing = fixture(); missing.chats.fetchChatInfo.mockResolvedValue({ data: {} });
        await expect(missing.run(args)).rejects.toThrow('metadata unavailable');
    });
});

describe('xiaohongshu CLI input and execution gates', () => {
    it('enforces observed 1000-character composer limit and verbatim text before navigation', () => {
        for (const text of ['a'.repeat(1001), ' leading', 'trailing ', 'a\r\nb']) expect(() => send.validateArgs({ target: userId, text })).toThrow();
        expect(() => send.validateArgs({ target: userId, text: 'Synthetic', execute: true })).toThrow('--approval');
        expect(() => open.validateArgs({ target: 'nickname' })).toThrow('user ID');
    });
});
