import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

import {
    assertConvId,
    assertMessageText,
    buildWaitForEchoJs,
    clampLimit,
    looksLoggedOut,
    normalizeConversations,
    normalizeMessages,
} from './dm-helpers.js';
import './dm-list.js';
import './dm-read.js';
import { __test__ as dmSendTest } from './dm-send.js';

const CHAT_URL = 'https://www.xiaohongshu.com/chat';
const CONV = '62318059000000001000bc1e';
const LOGGED_IN_BODY = '消息\n张三\n你好';

/**
 * openChat performs three evaluates (href, body text, dismiss notice) before
 * the command-specific ones, so every mock starts with those.
 */
function makePage({ href = `${CHAT_URL}/${CONV}`, body = LOGGED_IN_BODY, results = [], nativeType = true } = {}) {
    const evaluate = vi.fn();
    evaluate.mockResolvedValueOnce(href);
    evaluate.mockResolvedValueOnce(body);
    evaluate.mockResolvedValueOnce(false);
    for (const r of results) evaluate.mockResolvedValueOnce(r);
    evaluate.mockResolvedValue(undefined);
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
    if (nativeType) page.nativeType = vi.fn().mockResolvedValue(undefined);
    return page;
}

describe('xiaohongshu dm helpers', () => {
    it('accepts hex 1:1 ids and numeric group ids, rejects anything else', () => {
        expect(assertConvId(CONV)).toBe(CONV);
        expect(assertConvId(' 123456789 ')).toBe('123456789');
        expect(() => assertConvId('')).toThrow(ArgumentError);
        expect(() => assertConvId('abc')).toThrow(ArgumentError);
        expect(() => assertConvId('../etc')).toThrow(ArgumentError);
        expect(() => assertConvId(`${CONV}?x=1`)).toThrow(ArgumentError);
    });

    it('rejects empty message text', () => {
        expect(assertMessageText('  hi ')).toBe('hi');
        expect(() => assertMessageText('   ')).toThrow(ArgumentError);
        expect(() => assertMessageText(undefined)).toThrow(ArgumentError);
    });

    it('clamps limits to positive integers with a fallback', () => {
        expect(clampLimit(7.9, 50)).toBe(7);
        expect(clampLimit(0, 50)).toBe(50);
        expect(clampLimit('abc', 40)).toBe(40);
        expect(clampLimit(undefined, 40)).toBe(40);
    });

    it('detects the logged-out login modal text', () => {
        expect(looksLoggedOut('手机号登录\n获取验证码')).toBe(true);
        expect(looksLoggedOut(LOGGED_IN_BODY)).toBe(false);
        expect(looksLoggedOut(null)).toBe(false);
    });

    it('normalizes conversations, marks numeric ids as groups, drops rows without ids', () => {
        const rows = normalizeConversations([
            { id: CONV, name: ' 张三 ', time: '昨天', summary: '谢谢', unread: '2', pinned: true },
            { id: '123456789', name: '群聊', time: '', summary: '', unread: 0, pinned: false },
            { id: '', name: 'ghost' },
            null,
        ], 10);
        expect(rows).toEqual([
            { id: CONV, name: '张三', time: '昨天', summary: '谢谢', unread: 2, pinned: true, group: false },
            { id: '123456789', name: '群聊', time: '', summary: '', unread: 0, pinned: false, group: true },
        ]);
        expect(normalizeConversations(rows, 1)).toHaveLength(1);
    });

    it('normalizes messages, keeps the last N, collapses whitespace, labels own messages', () => {
        const rows = normalizeMessages([
            { time: '昨天 10:00', from: '张三', mine: false, text: '你好\n\n在吗' },
            { time: '昨天 10:01', from: '', mine: true, text: ' 在 ' },
            { time: '', from: '', mine: false, text: '   ' },
            { time: '刚刚', from: '张三', mine: false, text: 'x'.repeat(600) },
        ], 2);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ time: '昨天 10:01', from: 'me', mine: true, text: '在' });
        expect(rows[1].text).toHaveLength(500);
    });

    it('embeds only a short JSON-escaped prefix of the text in the echo probe', () => {
        const js = buildWaitForEchoJs('a"b'.repeat(20));
        expect(js).toContain(JSON.stringify('a"b'.repeat(20).slice(0, 30)));
        expect(js).not.toContain('a"b'.repeat(20));
    });
});

describe('xiaohongshu dm-list', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/dm-list');

    it('opens /chat and returns normalized conversations', async () => {
        const page = makePage({
            href: CHAT_URL,
            results: [[{ id: CONV, name: '张三', time: '昨天', summary: '谢谢', unread: 1, pinned: false }]],
        });
        const rows = await getCommand().func(page, { limit: 50 });
        expect(page.goto).toHaveBeenCalledWith(CHAT_URL, expect.objectContaining({ waitUntil: 'load' }));
        expect(page.wait).toHaveBeenCalledWith(expect.objectContaining({ selector: '.xhs-im-conv-item' }));
        expect(rows).toEqual([{ id: CONV, name: '张三', time: '昨天', summary: '谢谢', unread: 1, pinned: false, group: false }]);
    });

    it('unwraps browser bridge envelopes', async () => {
        const page = makePage({ href: CHAT_URL, results: [{ session: 's', data: [{ id: '123456789', name: 'g' }] }] });
        const rows = await getCommand().func(page, {});
        expect(rows[0]).toMatchObject({ id: '123456789', group: true });
    });

    it('throws AuthRequiredError when the page shows the login modal', async () => {
        const page = makePage({ href: CHAT_URL, body: '手机号登录 获取验证码' });
        await expect(getCommand().func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws AuthRequiredError on a /login redirect', async () => {
        const page = makePage({ href: 'https://www.xiaohongshu.com/login?redirectPath=/chat' });
        await expect(getCommand().func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError when navigation lands on a non-Xiaohongshu host', async () => {
        const page = makePage({ href: 'https://evil.example/chat' });
        await expect(getCommand().func(page, {})).rejects.toThrowError(/expected Xiaohongshu host/);
    });

    it('throws CommandExecutionError for a malformed list payload', async () => {
        const page = makePage({ href: CHAT_URL, results: [{ not: 'an array' }] });
        await expect(getCommand().func(page, {})).rejects.toThrowError(/malformed conversation-list payload/);
    });
});

describe('xiaohongshu dm-read', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/dm-read');

    it('opens /chat/<conv> and returns the last N messages', async () => {
        const page = makePage({
            results: [[
                { time: '昨天', from: '张三', mine: false, text: '你好' },
                { time: '刚刚', from: '', mine: true, text: '已关，谢谢' },
            ]],
        });
        const rows = await getCommand().func(page, { conv: CONV, limit: 40 });
        expect(page.goto).toHaveBeenCalledWith(`${CHAT_URL}/${CONV}`, expect.anything());
        expect(rows).toEqual([
            { time: '昨天', from: '张三', mine: false, text: '你好' },
            { time: '刚刚', from: 'me', mine: true, text: '已关，谢谢' },
        ]);
    });

    it('rejects a malformed conv id before navigation', async () => {
        const page = makePage();
        await expect(getCommand().func(page, { conv: 'nope' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws CommandExecutionError for a malformed message payload', async () => {
        const page = makePage({ results: ['not an array'] });
        await expect(getCommand().func(page, { conv: CONV })).rejects.toThrowError(/malformed message-list payload/);
    });
});

describe('xiaohongshu dm-send', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/dm-send');

    it('clears, types natively, presses Enter, and reports sent once the text echoes', async () => {
        const page = makePage({ results: [true, true] });
        const rows = await getCommand().func(page, { conv: CONV, text: '已关，谢谢' });
        expect(page.nativeType).toHaveBeenCalledWith('已关，谢谢');
        expect(page.pressKey).toHaveBeenCalledWith('Enter');
        expect(rows).toEqual([{ status: 'sent', conv: CONV, text: '已关，谢谢' }]);
    });

    it('falls back to execCommand typing when the page has no native input', async () => {
        const page = makePage({ nativeType: false, results: [true, true, true] });
        const rows = await getCommand().func(page, { conv: CONV, text: 'hi' });
        expect(rows[0].status).toBe('sent');
        const typingCall = page.evaluate.mock.calls[4][0];
        expect(typingCall).toContain('insertText');
        expect(typingCall).toContain(JSON.stringify('hi'));
    });

    it('throws when the composer is missing', async () => {
        const page = makePage({ results: [false] });
        await expect(getCommand().func(page, { conv: CONV, text: 'hi' })).rejects.toThrowError(/composer not found/);
        expect(page.pressKey).not.toHaveBeenCalled();
    });

    it('throws CommandExecutionError when the message never echoes in the list', async () => {
        const page = makePage({ results: [true, false] });
        await expect(getCommand().func(page, { conv: CONV, text: 'hi' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects empty text and bad ids before navigation', async () => {
        const page = makePage();
        await expect(getCommand().func(page, { conv: CONV, text: '  ' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(getCommand().func(page, { conv: 'x', text: 'hi' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('presses Enter as a full CDP key event when the page exposes cdp', async () => {
        const page = makePage({ results: [] });
        page.evaluate = vi.fn().mockResolvedValueOnce(true);
        page.cdp = vi.fn().mockResolvedValue(undefined);
        await dmSendTest.typeIntoComposer(page, 'x');
        expect(page.nativeType).toHaveBeenCalledWith('x');
        expect(page.cdp).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13 }));
        expect(page.cdp).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Enter' }));
        expect(page.pressKey).not.toHaveBeenCalled();
    });

    it('falls back to pressKey when the page has no cdp channel', async () => {
        const page = makePage({ results: [] });
        page.evaluate = vi.fn().mockResolvedValueOnce(true);
        await dmSendTest.typeIntoComposer(page, 'x');
        expect(page.pressKey).toHaveBeenCalledWith('Enter');
    });
});
