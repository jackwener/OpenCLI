import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __test__, editImageCommand } from './edit-image.js';

function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
        nativeClick: vi.fn().mockResolvedValue(undefined),
        cdp: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([]),
    };
}

const GEN_URL = 'https://p3-flow-imagex-sign.byteimg.com/tos-cn-i-a9rns2rl98/rc_gen_image/abc123.jpeg~tplv-a9rns2rl98-i_pre_wm_15_dk.png?lk3s=x&x-signature=y';

function runInDom(html, script, url = 'https://www.doubao.com/chat') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() {
            return this.textContent || '';
        },
    });
    Object.defineProperty(dom.window.HTMLImageElement.prototype, 'naturalWidth', {
        configurable: true,
        get() {
            return this.hasAttribute('data-lazy') ? 0 : 320;
        },
    });
    return dom.window.eval(script);
}

describe('edit-image composer probe script', () => {
    it('finds the 2026-08 tiptap ProseMirror editor', () => {
        const html = '<div><div contenteditable="true" role="textbox" class="tiptap ProseMirror"><p></p></div></div>';
        expect(runInDom(html, __test__.COMPOSER_PROBE_SCRIPT)).toBe('div.tiptap.ProseMirror');
    });

    it('prefers the 2026-07 Semi textarea when both markup generations exist', () => {
        const html = '<div>'
            + '<textarea class="semi-input-textarea" placeholder="发消息或按住空格说话..."></textarea>'
            + '<div class="tiptap ProseMirror" contenteditable="true"></div>'
            + '</div>';
        expect(runInDom(html, __test__.COMPOSER_PROBE_SCRIPT)).toBe('textarea.semi-input-textarea');
    });

    it('returns null when no composer markup exists', () => {
        expect(runInDom('<div><p>plain</p></div>', __test__.COMPOSER_PROBE_SCRIPT)).toBeNull();
    });
});

describe('edit-image result extraction script', () => {
    const resultHtml = (bodyText) => `<main><div class="list_items-root">${bodyText}
        <img src="https://cdn/rc_gen_image/aaa.jpeg~tplv-x.png?sig=1">
        <img src="https://cdn/rc_gen_image/aaa.jpeg~tplv-x.png?sig=2">
        <img src="https://cdn/other/bbb.png~tplv-x.png?sig=3">
        <img src="https://cdn/rc_gen_image/lazy.jpeg~tplv-x.png?sig=4" data-lazy>
        <img src="https://cdn/rc_gen_image/ccc.jpeg~tplv-x.png?sig=5" data-lazy>
    </div></main>`;

    it('keeps unique loaded rc_gen_image urls and dedupes by object path', () => {
        const result = runInDom(resultHtml('已完成'), __test__.RESULT_SCRIPT);
        expect(result.urls).toEqual(['https://cdn/rc_gen_image/aaa.jpeg~tplv-x.png?sig=1']);
        expect(result.busy).toBe(false);
        expect(result.fail).toBe(false);
    });

    it('dedupes cross-host template variants and keeps the hi-res i_pre_wm one', () => {
        const html = '<main><div class="list_items-root">'
            + '<img src="https://p3-flow-imagex-sign.byteimg.com/tos-cn-i-x/rc_gen_image/koi.jpeg~tplv-x-ds_wm_1_6_dk.png?sig=1">'
            + '<img src="https://p11-flow-imagex-sign.byteimg.com/tos-cn-i-x/rc_gen_image/koi.jpeg~tplv-x-i_pre_wm_16_dk.png?sig=2">'
            + '</div></main>';
        const result = runInDom(html, __test__.RESULT_SCRIPT);
        expect(result.urls).toEqual(['https://p11-flow-imagex-sign.byteimg.com/tos-cn-i-x/rc_gen_image/koi.jpeg~tplv-x-i_pre_wm_16_dk.png?sig=2']);
    });

    it('flags generation failure text from the conversation', () => {
        const result = runInDom(resultHtml('生成失败，请重试'), __test__.RESULT_SCRIPT);
        expect(result.fail).toBe(true);
    });
});

describe('edit-image submit state script', () => {
    it('captures the new conversation id and the cleared composer', () => {
        const html = '<div class="tiptap ProseMirror" contenteditable="true"><p><br></p></div>';
        const state = runInDom(html, __test__.SUBMIT_STATE_SCRIPT, 'https://www.doubao.com/chat/384390768365754');
        expect(state.conversationId).toBe('384390768365754');
        expect(state.composerLength).toBe(0);
    });

    it('captures the 2026-09 local_ prefixed conversation ids', () => {
        const html = '<div class="tiptap ProseMirror" contenteditable="true"><p><br></p></div>';
        const state = runInDom(html, __test__.SUBMIT_STATE_SCRIPT, 'https://www.doubao.com/chat/local_1408157205142109');
        expect(state.conversationId).toBe('local_1408157205142109');
    });

    it('returns no conversation id on the landing page', () => {
        const html = '<div class="tiptap ProseMirror" contenteditable="true"><p>把背景改成粉色</p></div>';
        const state = runInDom(html, __test__.SUBMIT_STATE_SCRIPT);
        expect(state.conversationId).toBeNull();
        expect(state.composerLength).toBeGreaterThan(0);
    });
});

describe('edit-image command flow', () => {
    const outgoing = { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    let outDir;
    let imagePath;

    afterEach(() => {
        vi.unstubAllGlobals();
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    function prepare(outgoingOverride) {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-edit-test-'));
        imagePath = path.join(outDir, 'source.png');
        fs.writeFileSync(imagePath, 'png');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(outgoingOverride ?? outgoing));
    }

    it('generates from a prompt without touching the file input (text-to-image)', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 0 })
            .mockResolvedValueOnce({ urls: [GEN_URL], busy: false, fail: false });
        const rows = await editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 });
        expect(page.setFileInput).not.toHaveBeenCalled();
        expect(rows).toHaveLength(1);
        expect(rows[0].Index).toBe(1);
        expect(rows[0].ConversationId).toBe('123456789012');
        expect(rows[0].SavedTo).toBe(path.join(outDir, 'doubao_edit_123456789012_1.png'));
        expect(fs.existsSync(rows[0].SavedTo)).toBe(true);
    });

    it('uploads the image via CDP when --image is provided (edit mode)', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 0 })
            .mockResolvedValueOnce({ urls: [GEN_URL], busy: false, fail: false });
        const rows = await editImageCommand.func(page, { prompt: '把背景改成粉色', image: imagePath, out: outDir, timeout: 60 });
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath], 'input[type=file]');
        expect(rows).toHaveLength(1);
    });

    it('throws ArgumentError when the image file does not exist', async () => {
        prepare();
        const page = createPageMock();
        await expect(editImageCommand.func(page, { prompt: '改背景', image: 'Z:/no/such.png', out: outDir, timeout: 60 }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('throws ArgumentError when the timeout is below the minimum', async () => {
        prepare();
        const page = createPageMock();
        await expect(editImageCommand.func(page, { prompt: '画', out: outDir, timeout: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('throws a command error when the composer never appears', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValue(null);
        await expect(editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 }))
            .rejects.toThrow(/composer not found/i);
    });

    it('throws a command error when the upload never registers', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValue(0);
        await expect(editImageCommand.func(page, { prompt: '改背景', image: imagePath, out: outDir, timeout: 60 }))
            .rejects.toThrow(/did not register/i);
    });

    it('throws a command error when submission never creates a conversation', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValue(null);
        await expect(editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 }))
            .rejects.toThrow(/not submitted/i);
    });

    it('re-clicks the send button with the native flavor when the composer did not clear', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 29 })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 0 })
            .mockResolvedValueOnce({ urls: [GEN_URL], busy: false, fail: false });
        const rows = await editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 });
        expect(page.nativeClick).toHaveBeenCalledWith(100, 100);
        expect(rows).toHaveLength(1);
    });

    it('surfaces a TimeoutError when Doubao reports a generation failure', async () => {
        prepare();
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 0 })
            .mockResolvedValueOnce({ urls: [], busy: false, fail: true })
            .mockResolvedValueOnce({ detected: false });
        await expect(editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 }))
            .rejects.toBeInstanceOf(TimeoutError);
    });

    it('fails fast with a command error when Doubao injects a captcha challenge', async () => {
        prepare();
        // Drive the poll deadline with fake time: the mocked page.wait resolves
        // instantly, so a real-clock loop would spin hot for the whole timeout.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const page = createPageMock();
        vi.mocked(page.wait).mockImplementation(async (seconds) => {
            vi.setSystemTime(Date.now() + (seconds || 0) * 1000);
        });
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce('div.tiptap.ProseMirror')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ w: 1280, h: 800 })
            .mockResolvedValueOnce({ x: 100, y: 100 })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ conversationId: '123456789012', composerLength: 0 })
            .mockImplementation(async (script) => {
                if (typeof script === 'string' && script.includes('rc_gen_image')) {
                    return { urls: [], busy: false, fail: false };
                }
                if (typeof script === 'string' && script.includes('captcha')) {
                    return { detected: true, reason: 'iframe[src*="captcha"]' };
                }
                return null;
            });
        await expect(editImageCommand.func(page, { prompt: '画一只橘猫', out: outDir, timeout: 60 }))
            .rejects.toThrow(/verification challenge/);
        vi.useRealTimers();
    });
});
