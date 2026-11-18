import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { command as inbox } from './inbox.js';
import { command as messages } from './messages.js';
import { buildImEvaluate, evaluateIm, parsePrivateTarget, projectPrivateMessage } from './im.js';
import { INBOX_COLUMNS, MESSAGE_COLUMNS } from '../_shared/private-messages.js';

const threadId = '0:1:100:200';
const position = '9007199254741200';
const body = JSON.stringify({ aweType: 0, text: 'Synthetic text' });
const rawMessage = (index = position, overrides = {}) => ({
    serverId: `800000000000000${index.slice(-4)}`, conversationId: threadId, sender: '100',
    isFromMe: true, type: 7, content: body, createdAt: new Date(1700000000000),
    isRecalled: false, visible: true, indexInConversation: { toString: () => index }, ...overrides,
});
const model = (overrides = {}) => ({
    id: threadId, type: 1, toParticipantUserId: '200', unreadCount: 0,
    lastMessageIndex: { toString: () => position }, lastVisibleMessage: rawMessage(), ...overrides,
});
const browserChat = { threadId, peerId: '200', latestPosition: position };
const rawProjection = (overrides = {}) => ({
    threadId, serverId: '8000000000000000001', authorId: '100', fromMe: true,
    kind: 7, body, timeMs: 1700000000000, recalled: false, shown: true, position, ...overrides,
});
const doms = [];
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    doms.splice(0).forEach(dom => dom.window.close());
});

function fixture(conversations = [model()], overrides = {}) {
    const dom = new JSDOM('<div id="imSaasContainerId"></div>', { url: 'https://www.douyin.com/' });
    doms.push(dom);
    vi.stubGlobal('document', dom.window.document);
    const nextParams = { hasMore: false, page: 1, versionForNextQuery: '1' };
    const sdk = {
        plugins: [{ initLinkInstance: { nextParams } }],
        getConversationList: vi.fn(options => options?.filter ? conversations.filter(options.filter) : conversations),
        getConversation: vi.fn(({ conversationId }) => conversations.find(conversation => conversation.id === conversationId)),
        getMessagesByConversation: vi.fn().mockResolvedValue({ messages: [rawMessage()], hasMore: false, cursor: position }),
        ...overrides,
    };
    const store = { hasMore: true, isLoading: false, loadMoreConversations: vi.fn() };
    const manager = { loadMoreConversations: vi.fn().mockResolvedValue(true) };
    const app = {
        imSdkService: {
            imSdkManager: { getImSdkInstance: () => sdk, useWebImSdkNext: false },
            conversationListManager: manager,
        },
        store: {
            conversationStore: store,
            usersInfoStore: { usersInfoMap: new Map([['200', { nickname: 'Synthetic peer', sec_uid: 'MS4wSynthetic' }]]) },
        },
    };
    dom.window.document.querySelector('#imSaasContainerId').__reactFiber$fixture = {
        memoizedProps: {}, return: { memoizedProps: { value: app }, return: null },
    };
    const page = {
        goto: vi.fn().mockResolvedValue(), wait: vi.fn().mockResolvedValue(),
        evaluate: vi.fn(async code => eval(code)),
    };
    return { page, sdk, app, nextParams, manager, store };
}

describe('douyin private identifiers', () => {
    it('requires exact private IDs or numeric peer IDs', () => {
        expect(parsePrivateTarget(threadId)).toBe(threadId);
        expect(parsePrivateTarget('200')).toBe('200');
        for (const value of ['', 'Nickname', 'MS4wNotUid', '0:2:100:200', '0:1:100:200\";alert(1)']) {
            expect(() => parsePrivateTarget(value)).toThrow();
        }
    });
    it('serializes parameters safely into page code and does not use fixed webpack modules', () => {
        const code = buildImEvaluate('find', { target: '\";throw Error(123);//' });
        expect(code).toContain(JSON.stringify({ target: '\";throw Error(123);//' }));
        expect(code).not.toContain('req(5245)');
        expect(code).not.toContain('markConversationRead(');
        expect(code).not.toContain('.click(');
    });
});

describe('douyin inbox via IM provider and SDK', () => {
    it('reads decoded private models, excluding groups and matching output columns', async () => {
        const { page } = fixture([model(), model({ type: 2, id: 'group-id' })]);
        const rows = await inbox.func(page, { limit: 20 });
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0])).toEqual(INBOX_COLUMNS);
        expect(rows[0]).toMatchObject({ conversation_id: threadId, user_id: '200', nickname: 'Synthetic peer', last_message: 'Synthetic text', unread_count: 0 });
    });
    it('uses the actual legacy SDK end flag, not the store success flag', async () => {
        const { page, store, manager } = fixture();
        expect(store.hasMore).toBe(true);
        expect(await inbox.func(page, { limit: 100 })).toHaveLength(1);
        expect(manager.loadMoreConversations).not.toHaveBeenCalled();
    });
    it('loads additional pages until the SDK confirms completion', async () => {
        const conversations = [model()];
        const { page, manager, nextParams } = fixture(conversations);
        nextParams.hasMore = true;
        manager.loadMoreConversations.mockImplementation(async () => {
            conversations.push(model({ id: '0:1:100:300', toParticipantUserId: '300' }));
            nextParams.hasMore = false;
            return true;
        });
        expect(await inbox.func(page, { limit: 3 })).toHaveLength(2);
        expect(manager.loadMoreConversations).toHaveBeenCalledTimes(1);
    });
    it('supports the next SDK store pagination path', async () => {
        const { page, app, store } = fixture();
        app.imSdkService.imSdkManager.useWebImSdkNext = true;
        store.loadMoreConversations.mockImplementation(async () => { store.hasMore = false; });
        expect(await inbox.func(page, { limit: 3 })).toHaveLength(1);
        expect(store.loadMoreConversations).toHaveBeenCalledTimes(1);
    });
    it('fails on stalls, loader failure and missing completion flags', async () => {
        const stalled = fixture();
        stalled.nextParams.hasMore = true;
        await expect(inbox.func(stalled.page, {})).rejects.toThrow('stalled');
        const failed = fixture();
        failed.nextParams.hasMore = true;
        failed.manager.loadMoreConversations.mockResolvedValue(false);
        await expect(inbox.func(failed.page, {})).rejects.toThrow('failed');
        const missing = fixture();
        delete missing.nextParams.hasMore;
        await expect(inbox.func(missing.page, {})).rejects.toThrow('completion flag');
    });
    it('represents absent user metadata as null, not a fabricated nickname', async () => {
        const { page, app } = fixture();
        app.store.usersInfoStore.usersInfoMap.clear();
        expect((await inbox.func(page, {}))[0]).toMatchObject({ nickname: null, profile_url: null });
    });
    it('reports an empty inbox explicitly', async () => {
        await expect(inbox.func(fixture([]).page, {})).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
});

describe('douyin unread filtering and incremental messages', () => {
    it('loads unread conversations beyond the first read batch', async () => {
        const conversations = [model()];
        const { page, manager, nextParams } = fixture(conversations);
        nextParams.hasMore = true;
        manager.loadMoreConversations.mockImplementation(async () => {
            conversations.push(model({ id: '0:1:100:300', toParticipantUserId: '300', unreadCount: 2 }));
            nextParams.hasMore = false;
            return true;
        });
        const rows = await inbox.func(page, { unread: true, limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ user_id: '300', unread_count: 2 });
        expect(manager.loadMoreConversations).toHaveBeenCalledTimes(1);
    });
    it('fails on invalid unread counters rather than filtering them out', async () => {
        await expect(inbox.func(fixture([model({ unreadCount: null })]).page, { unread: true })).rejects.toThrow('Invalid unread count');
    });
    it('returns verified no-new-messages for an exact existing checkpoint', async () => {
        const { page } = fixture();
        expect(await messages.func(page, { target: '200', 'after-message': rawMessage().serverId })).toEqual([]);
    });
});

describe('douyin messages', () => {
    it('selects a stable peer ID and includes the newest index without rounding Long integers', async () => {
        const { page, sdk } = fixture();
        const rows = await messages.func(page, { target: '200', limit: 1 });
        expect(Object.keys(rows[0])).toEqual(MESSAGE_COLUMNS);
        expect(rows[0]).toMatchObject({ conversation_id: threadId, type: 'text', is_self: true });
        expect(sdk.getMessagesByConversation).toHaveBeenCalledWith(expect.objectContaining({ cursor: '9007199254741201', limit: 50 }));
    });
    it('reads successive history pages until server hasMore is false and emits chronological conversation order', async () => {
        const { page, sdk } = fixture();
        sdk.getMessagesByConversation
            .mockResolvedValueOnce({ messages: [rawMessage()], hasMore: true, cursor: position })
            .mockResolvedValueOnce({ messages: [rawMessage('9007199254741199')], hasMore: false, cursor: '9007199254741199' });
        const rows = await messages.func(page, { target: threadId, all: true });
        expect(rows).toHaveLength(2);
        expect(rows[0].message_id).toBe(rawMessage('9007199254741199').serverId);
        expect(sdk.getMessagesByConversation.mock.calls[1][0].cursor).toBe(position);
    });
    it('rejects a changed thread identity, repeated cursor and missing hasMore', async () => {
        const changed = fixture();
        changed.sdk.getConversation.mockReturnValue(model({ id: '0:1:100:300' }));
        await expect(messages.func(changed.page, { target: threadId })).rejects.toThrow('identity');
        const repeated = fixture();
        repeated.sdk.getMessagesByConversation.mockResolvedValue({ messages: [rawMessage()], hasMore: true, cursor: '9007199254741201' });
        await expect(messages.func(repeated.page, { target: threadId, all: true })).rejects.toThrow('cursor');
        const missing = fixture();
        missing.sdk.getMessagesByConversation.mockResolvedValue({ messages: [rawMessage()] });
        await expect(messages.func(missing.page, { target: threadId })).rejects.toThrow('completion');
    });
    it('rejects history beyond the fixed upper snapshot bound', async () => {
        const { page, sdk } = fixture();
        sdk.getMessagesByConversation.mockResolvedValue({ messages: [rawMessage('9007199254741202')], hasMore: false });
        await expect(messages.func(page, { target: threadId })).rejects.toThrow('snapshot');
    });
    it('rejects invalid options before opening the browser', async () => {
        const { page } = fixture();
        await expect(messages.func(page, { target: threadId, all: true, limit: 1 })).rejects.toThrow('--all');
        await expect(messages.func(page, { target: 'nickname' })).rejects.toThrow('numeric user ID');
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('reports missing targets and empty histories explicitly', async () => {
        const missing = fixture();
        await expect(messages.func(missing.page, { target: '999' })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        const empty = fixture();
        empty.sdk.getMessagesByConversation.mockResolvedValue({ messages: [], hasMore: false });
        await expect(messages.func(empty.page, { target: threadId, all: true })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
    it('preserves media and unknown types and omits invisible SDK control events', () => {
        expect(projectPrivateMessage(rawProjection({ shown: false }), browserChat)).toBeNull();
        const raw = rawProjection({ recalled: true, kind: 999, body: JSON.stringify({ resource_url: 'https://example.invalid/media' }) });
        expect(projectPrivateMessage(raw, browserChat)).toMatchObject({ type: 'unknown:999', text: null, revoked: true, raw_content: raw.body });
        expect(() => projectPrivateMessage(rawProjection({ threadId: '0:1:100:300' }), browserChat)).toThrow('mismatched');
        expect(() => projectPrivateMessage(rawProjection({ timeMs: 0 }), browserChat)).toThrow('timestamp');
    });
});

describe('douyin IM availability', () => {
    it('classifies login errors without silently returning an empty list', async () => {
        const { page, sdk } = fixture();
        sdk.getConversationList.mockImplementation(() => { throw new Error('用户未登录'); });
        await expect(evaluateIm(page, 'list', { limit: 20 })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });
    it('reports provider drift and initialization timeouts', async () => {
        const { page } = fixture();
        document.querySelector('#imSaasContainerId').remove();
        await expect(evaluateIm(page, 'list', { limit: 20 })).rejects.toThrow('provider');
        vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(15000);
        await expect(evaluateIm(page, 'ready')).rejects.toMatchObject({ code: 'TIMEOUT' });
    });
});
