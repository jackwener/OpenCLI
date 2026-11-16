import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildWriteScript } from './write-im.js';
import { buildFollowScript } from './follow.js';
import { command as send } from './send.js';
import { command as open } from './conversation-open.js';
import { command as follow } from './follow.js';
import { command as unfollow } from './unfollow.js';
const id = '0:1:100:200'; const secUid = 'MS4wLjABAAAASyntheticPeer001';
const doms = [];
afterEach(() => { vi.restoreAllMocks(); doms.splice(0).forEach(dom => dom.window.close()); });
function fixture(existing = true) {
    const dom = new JSDOM('<div id="imSaasContainerId"></div>', { url: 'https://www.douyin.com/', runScripts: 'outside-only' }); doms.push(dom);
    const conversation = { id, type: 1, toParticipantUserId: '200', lastMessageIndex: { toString: () => '0' } };
    const conversations = existing ? [conversation] : [];
    const sdk = {
        ctx: { option: { userId: '100' } }, getConversationList: vi.fn(opts => conversations.filter(opts.filter)),
        createConversation: vi.fn(async () => { conversations.push(conversation); return { success: true, statusCode: 0, payload: conversation }; }),
        getMessagesByConversation: vi.fn(async () => ({ messages: [], hasMore: false })),
        createMessage: vi.fn(async args => ({ clientId: args.clientId, conversationId: args.conversation.id, conversationType: 1, type: args.type, content: args.content, sender: '100' })),
        sendMessage: vi.fn(async ({ message }) => { message.serverId = '900'; return { success: true, statusCode: 0 }; }),
    };
    const app = { imSdkService: { imSdkManager: { getImSdkInstance: () => sdk } } };
    dom.window.document.querySelector('#imSaasContainerId').__reactFiber$test = { memoizedProps: { value: app } };
    const run = args => dom.window.eval(buildWriteScript(args));
    return { dom, run, sdk, conversation };
}
const mutation = { operation: 'send', userId: '200', accountId: '100', conversationId: id, revision: '0', text: 'Synthetic "safe" text', requestId: '11111111-1111-4111-8111-111111111111', expiresAt: Date.now() + 600000 };

describe('douyin native IM write contract', () => {
    it('preflights a new author without creating a server conversation', async () => {
        const f = fixture(false);
        expect(await f.run({ operation: 'probe', userId: '200' })).toMatchObject({ accountId: '100', conversationId: null, revision: 'absent' });
        expect(f.sdk.createConversation).not.toHaveBeenCalled(); expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('creates exactly one native one-to-one conversation for a new author, without sending', async () => {
        const f = fixture(false);
        expect(await f.run({ ...mutation, operation: 'conversation-open', conversationId: null, revision: 'absent' })).toMatchObject({ status: 'opened', conversationId: id });
        expect(f.sdk.createConversation).toHaveBeenCalledExactlyOnceWith({ type: 1, participants: '200', inboxType: 0 });
        expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('opens an existing conversation without creation or mark-read calls', async () => {
        const f = fixture();
        expect((await f.run({ ...mutation, operation: 'conversation-open' })).status).toBe('opened');
        expect(f.sdk.createConversation).not.toHaveBeenCalled();
    });
    it('sends once with stable client UUID, literal JSON text and insert=false', async () => {
        const f = fixture();
        expect(await f.run(mutation)).toMatchObject({ status: 'sent', messageId: '900' });
        expect(f.sdk.createMessage).toHaveBeenCalledWith({ conversation: f.conversation, type: 7, content: JSON.stringify({ aweType: 0, text: mutation.text }), clientId: mutation.requestId, insert: false });
        expect(f.sdk.sendMessage).toHaveBeenCalledTimes(1);
    });
    it('supports first send after approved native creation when server history is empty', async () => {
        const f = fixture(false);
        expect((await f.run({ ...mutation, conversationId: null, revision: 'absent' })).status).toBe('sent');
        expect(f.sdk.createConversation).toHaveBeenCalledTimes(1); expect(f.sdk.sendMessage).toHaveBeenCalledTimes(1);
    });
    it('blocks unseen old server history, changed accounts and recipient mismatches', async () => {
        const old = fixture(false); old.conversation.lastMessageIndex = '5';
        await expect(old.run({ ...mutation, conversationId: null, revision: 'absent' })).rejects.toThrow('unreviewed history');
        expect(old.sdk.sendMessage).not.toHaveBeenCalled();
        const changed = fixture(); changed.sdk.ctx.option.userId = '300';
        await expect(changed.run(mutation)).rejects.toThrow('Account changed');
        const wrong = fixture(); wrong.conversation.id = '0:1:300:200';
        await expect(wrong.run(mutation)).rejects.toThrow('identity mismatch');
    });
    it('blocks latest-message changes and expiry before any send', async () => {
        const f = fixture(); f.conversation.lastMessageIndex = '1';
        await expect(f.run(mutation)).rejects.toThrow('context changed');
        await expect(f.run({ ...mutation, expiresAt: 0 })).rejects.toThrow('expired');
        expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it.each([{ messages: [{ serverId: 'old' }], hasMore: false }, { messages: [], hasMore: true }, null])('does not treat default zero position as proof of empty server history', async history => {
        const f = fixture(false); f.sdk.getMessagesByConversation.mockResolvedValue(history);
        await expect(f.run({ ...mutation, conversationId: null, revision: 'absent' })).rejects.toThrow('Empty server history is not confirmed');
        expect(f.sdk.createMessage).not.toHaveBeenCalled(); expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('rechecks recipient identity after asynchronous message creation', async () => {
        const f = fixture();
        const create = f.sdk.createMessage.getMockImplementation();
        f.sdk.createMessage.mockImplementation(async args => { const message = await create(args); f.conversation.toParticipantUserId = '300'; return message; });
        await expect(f.run(mutation)).rejects.toThrow('identity mismatch');
        expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('rejects a replaced SDK instance even if the old instance still has the approved account', async () => {
        const f = fixture();
        const create = f.sdk.createMessage.getMockImplementation();
        f.sdk.createMessage.mockImplementation(async args => {
            const message = await create(args);
            f.dom.window.document.querySelector('#imSaasContainerId').__reactFiber$test.memoizedProps.value.imSdkService.imSdkManager.getImSdkInstance = () => ({ ...f.sdk });
            return message;
        });
        await expect(f.run(mutation)).rejects.toThrow('account changed');
        expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('rejects SDK-rewritten content before sending', async () => {
        const f = fixture(); f.sdk.createMessage.mockResolvedValue({ clientId: mutation.requestId, conversationId: id, conversationType: 1, type: 7, content: 'changed', sender: '100' });
        await expect(f.run(mutation)).rejects.toThrow('content changed');
        expect(f.sdk.sendMessage).not.toHaveBeenCalled();
    });
    it('does not retry rejected/ambiguous SDK outcomes or report self-visible messages as sent', async () => {
        const f = fixture(); f.sdk.sendMessage.mockResolvedValue({ success: false, statusCode: 20 });
        expect((await f.run(mutation)).status).toBe('unknown');
        expect(f.sdk.sendMessage).toHaveBeenCalledTimes(1);
        const empty = fixture(); empty.sdk.sendMessage.mockResolvedValue({ success: true, statusCode: 0 });
        expect((await empty.run(mutation)).status).toBe('unknown');
    });
});

describe('douyin visible follow controls', () => {
    function profile(label = '关注') {
        const dom = new JSDOM(`<div id="imSaasContainerId"></div><button data-e2e="user-info-follow-btn">${label}</button>`, { url: `https://www.douyin.com/user/${secUid}`, runScripts: 'outside-only' }); doms.push(dom);
        dom.window.SSR_RENDER_DATA = { app: { user: { info: { uid: '100' } } } };
        const sdk = { ctx: { option: { userId: '100' } } };
        dom.window.document.querySelector('#imSaasContainerId').__reactFiber$test = { memoizedProps: { value: { imSdkService: { imSdkManager: { getImSdkInstance: () => sdk } } } } };
        const button = dom.window.document.querySelector('button'); button.getBoundingClientRect = () => ({ width: 100 });
        const info = { uid: '200', secUid, nickname: 'Synthetic' };
        button.__reactFiber$test = { memoizedProps: { userInfo: info } };
        const click = vi.spyOn(button, 'click');
        return { dom, button, click, info, sdk, run: args => dom.window.eval(buildFollowScript({ secUid, ...args })) };
    }
    it('preflights without clicking and follows/unfollows only the verified control', () => {
        const f = profile(); expect(f.run({ operation: 'probe' })).toMatchObject({ accountId: '100', userId: '200', revision: 'not-following' });
        expect(f.click).not.toHaveBeenCalled();
        expect(f.run({ operation: 'follow', accountId: '100', userId: '200', revision: 'not-following', expiresAt: mutation.expiresAt }).status).toBe('clicked');
        expect(f.click).toHaveBeenCalledTimes(1);
        const u = profile('相互关注');
        expect(u.run({ operation: 'unfollow', accountId: '100', userId: '200', revision: 'following', expiresAt: mutation.expiresAt }).status).toBe('clicked');
    });
    it('rejects a changed live SDK account even when bootstrap SSR still has the old account', () => {
        const f = profile(); f.sdk.ctx.option.userId = '300';
        expect(() => f.run({ operation: 'follow', accountId: '100', userId: '200', revision: 'not-following', expiresAt: mutation.expiresAt })).toThrow('Live account changed');
        expect(f.click).not.toHaveBeenCalled();
    });
    it('is idempotent when already in the requested state', () => {
        const f = profile('已关注');
        expect(f.run({ operation: 'follow', accountId: '100', userId: '200', revision: 'following', expiresAt: mutation.expiresAt }).status).toBe('already-following');
        expect(f.click).not.toHaveBeenCalled();
    });
    it('rejects expired approval, changed account and changed target before clicking', () => {
        const f = profile();
        expect(() => f.run({ operation: 'follow', accountId: '100', userId: '200', revision: 'not-following', expiresAt: 0 })).toThrow('changed');
        expect(() => f.run({ operation: 'follow', accountId: '300', userId: '200', revision: 'not-following', expiresAt: mutation.expiresAt })).toThrow('changed');
        f.info.secUid = 'MS4wLjABAAAAOtherAuthor000';
        expect(() => f.run({ operation: 'probe' })).toThrow('mismatch');
        expect(f.click).not.toHaveBeenCalled();
    });
});

describe('douyin CLI write gates', () => {
    it.each([send, open, follow, unfollow])('requires approval for execution before browser navigation', command => {
        expect(() => command.validateArgs({ target: secUid, text: 'Synthetic', execute: true })).toThrow('--approval');
    });
});
