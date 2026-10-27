import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import { buildSendVerifyJs } from './live-comment-send.js';
import './live-comment-send.js';

const ROOM_URL = 'https://www.xiaohongshu.com/livestream/570440812909234340?xsec_token=ABtok';

describe('xiaohongshu/live-comment-send command', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/live-comment-send');

    function makeSendPage({ prepare = { ok: true, content: '666', sendVisible: true }, clicked = { clicked: true }, verify = { sent: true, commentId: 'c9', cleared: true } } = {}) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                const s = String(script);
                if (s.includes('insertText')) return prepare;
                if (s.includes('__send_click')) return clicked;
                if (s.includes('__send_verify')) return verify;
                throw new Error(`unexpected script: ${s.slice(0, 40)}`);
            }),
        };
    }

    it('registers as a persistent write with adapter-owned navigation', () => {
        const cmd = getCommand();
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('write');
        expect(cmd.siteSession).toBe('persistent');
        expect(cmd.navigateBefore).toBe(false);
    });

    it('sends and reports the verified comment', async () => {
        const page = makeSendPage();
        const rows = await getCommand().func(page, { 'room-url': ROOM_URL, text: '666' });
        expect(rows).toEqual([{ status: 'sent', room_id: '570440812909234340', msg: '666', comment_id: 'c9' }]);
        expect(page.goto).toHaveBeenCalledWith(ROOM_URL);
    });

    it('rejects empty or over-long text before navigation', async () => {
        const page = makeSendPage();
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, text: '   ' })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, text: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('fails typed when the comment box is missing (logged out / room ended)', async () => {
        const page = makeSendPage({ prepare: { ok: false, reason: 'no_input_box' } });
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, text: '666' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('no_input_box') });
    });

    it('fails when the typed content does not match before sending (never sends garbled input)', async () => {
        const page = makeSendPage({ prepare: { ok: true, content: '66', sendVisible: true } });
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, text: '666' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('mismatch') });
        expect(page.evaluate.mock.calls.every(([s]) => !String(s).includes('__send_click'))).toBe(true);
    });

    it('fails when the postcondition never confirms the comment landed', async () => {
        const page = makeSendPage({ verify: { sent: false, cleared: false } });
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, text: '666' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('not confirmed') });
    });
});


describe('buildSendVerifyJs (DOM-primary confirmation, JSDOM)', () => {
    function makeVerifyDom({ boxText = '', chat = [], storeEcho = null, ownNick = '啊啊啊啊啊嚏' } = {}) {
        const dom = new JSDOM('<div class="input-editable"></div><div class="live-chat"><div class="virtual-list"></div></div>', {
            url: 'https://www.xiaohongshu.com/livestream/1',
        });
        const win = dom.window;
        win.document.querySelector('.input-editable').textContent = boxText;
        const list = win.document.querySelector('.virtual-list');
        for (const [nick, msg] of chat) {
            const item = win.document.createElement('div');
            item.className = 'virtual-list-item';
            item.innerHTML = '<div class="msg-wrapper"><div class="msg-content"><span class="nickname">' + nick + '</span> ' + msg + '</div></div>';
            list.appendChild(item);
        }
        win.__INITIAL_STATE__ = {
            user: { userInfo: { _value: { nickname: ownNick } } },
            liveStream: { comments: { _value: storeEcho ? [storeEcho] : [] } },
        };
        return (script) => Function('window', 'document', `return (${script})`)(win, win.document);
    }

    it('confirms via the DOM when our nickname+text appear in chat (frozen store, no echo)', () => {
        const run = makeVerifyDom({ chat: [['路人', '好耶'], ['啊啊啊啊啊嚏', '白鹿白鹿白鹿']] });
        const v = run(buildSendVerifyJs('白鹿白鹿白鹿'));
        expect(v.sent).toBe(true);
        expect(v.commentId).toBe('');
    });

    it('attaches the server comment id when the store echo exists', () => {
        const run = makeVerifyDom({
            chat: [['啊啊啊啊啊嚏', '加油']],
            storeEcho: { msg: '加油', commentId: '777' },
        });
        const v = run(buildSendVerifyJs('加油'));
        expect(v).toMatchObject({ sent: true, commentId: '777' });
    });

    it('does not confirm when only someone ELSE posted the same text', () => {
        const run = makeVerifyDom({ chat: [['路人', '白鹿白鹿白鹿']] });
        expect(run(buildSendVerifyJs('白鹿白鹿白鹿')).sent).toBe(false);
    });

    it('does not confirm while the input box still holds the text', () => {
        const run = makeVerifyDom({ boxText: '白鹿白鹿白鹿', chat: [['啊啊啊啊啊嚏', '白鹿白鹿白鹿']] });
        expect(run(buildSendVerifyJs('白鹿白鹿白鹿')).sent).toBe(false);
    });
});
