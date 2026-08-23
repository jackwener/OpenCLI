import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './create-draft.js';
import './drafts.js';
import './search.js';

function createPageMock(overrides = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: overrides.evaluate ?? vi.fn().mockResolvedValue(undefined),
        setFileInput: Object.hasOwn(overrides, 'setFileInput')
            ? overrides.setFileInput
            : vi.fn().mockResolvedValue(undefined),
    };
}

function envelope(data) {
    return { session: 'site:weixin:test', data };
}

function createDraftEvaluate({ uploadReady = true, coverSelected = true, saveConfirmed = true, fallbackOk = true } = {}) {
    let saveStateReads = 0;
    return vi.fn().mockImplementation(async (script) => {
        if (script.includes('window.location.href.match')) return envelope('123456');
        if (script.includes('!!document.querySelector("textarea#title")')) return envelope(true);
        if (script.includes("reason: 'field not found'")) return envelope({ ok: true });
        if (script.includes("reason: 'content editor not found'")) return envelope({ ok: true });
        if (script.includes("return Array.from(editor.querySelectorAll('img')).map")) return envelope([]);
        if (script.includes("document.querySelector('#js_editor_insertimage')")) return envelope({ ok: true });
        if (script.includes("document.querySelector('.js_img_dropdown_menu .tpl_dropdown_menu_item')")) return envelope({ ok: true });
        if (script.includes('var transfer = new DataTransfer()')) return envelope(fallbackOk ? { ok: true } : { ok: false, reason: 'input rejected file' });
        if (script.includes('var previous = new Set')) return envelope({ ok: uploadReady, errorText: '' });
        if (script.includes("(el.textContent || '').trim() === '确认'")) return envelope(true);
        if (script.includes("var area = document.querySelector('#js_cover_area')")) return envelope(coverSelected);
        if (script.includes("find(function(value) { return /已保存|保存成功/.test(value); })")) {
            saveStateReads += 1;
            return envelope(saveStateReads === 1 || !saveConfirmed
                ? { visible: false, text: '' }
                : { visible: true, text: '保存成功' });
        }
        if (script.includes("=== '保存为草稿'")) return envelope({ ok: true });
        return envelope(undefined);
    });
}

const tempDirs = [];

function createTempImage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-weixin-'));
    tempDirs.push(dir);
    const imagePath = path.join(dir, 'cover.png');
    fs.writeFileSync(imagePath, 'fake-png');
    return imagePath;
}

afterEach(() => {
    while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('weixin command registration', () => {
    it('registers create-draft and drafts commands', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        expect(values.find(c => c.site === 'weixin' && c.name === 'create-draft')).toBeDefined();
        const draftsCommand = values.find(c => c.site === 'weixin' && c.name === 'drafts');
        expect(draftsCommand).toBeDefined();
        expect(draftsCommand.args.find((arg) => arg.name === 'timeout')).toMatchObject({ type: 'int', default: 60 });
        expect(values.find(c => c.site === 'weixin' && c.name === 'search')).toBeDefined();
    });
});

describe('weixin drafts command', () => {
    it('throws AuthRequiredError when no session token is available', async () => {
        const command = getRegistry().get('weixin/drafts');
        const page = createPageMock({
            evaluate: vi.fn().mockResolvedValueOnce(undefined),
        });

        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails instead of scraping arbitrary body text when structured selectors miss', async () => {
        const command = getRegistry().get('weixin/drafts');
        const evaluate = vi.fn()
            .mockResolvedValueOnce('123456')
            .mockImplementationOnce(async (script) => {
                expect(script).not.toContain('document.body.innerText');
                return [];
            });
        const page = createPageMock({ evaluate });

        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns structured drafts and respects the requested limit', async () => {
        const command = getRegistry().get('weixin/drafts');
        const page = createPageMock({
            evaluate: vi.fn()
                .mockResolvedValueOnce('123456')
                .mockResolvedValueOnce([
                    { Index: 1, Title: '第一篇草稿', Time: '2026-04-24 10:00' },
                    { Index: 2, Title: '第二篇草稿', Time: '2026-04-24 11:00' },
                ]),
        });

        const result = await command.func(page, { limit: 1 });

        expect(result).toEqual([
            { Index: 1, Title: '第一篇草稿', Time: '2026-04-24 10:00' },
        ]);
    });
});

describe('weixin create-draft cover upload', () => {
    const command = getRegistry().get('weixin/create-draft');

    it('rejects a missing cover file before browser navigation', async () => {
        const page = createPageMock();

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': '/definitely/missing/cover.png',
        })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps raw browser failures to CommandExecutionError', async () => {
        const page = createPageMock({ evaluate: vi.fn().mockRejectedValue(new Error('bridge disconnected')) });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('uses setFileInput and only reports success after upload, cover, and save postconditions', async () => {
        const imagePath = createTempImage();
        const page = createPageMock({ evaluate: createDraftEvaluate() });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': imagePath,
        })).resolves.toEqual([{ status: 'draft saved', detail: '"测试草稿" (with cover)' }]);
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath], 'input[type="file"][name="file"]');
    });

    it('falls back to DataTransfer for stale-extension upload errors and unwraps bridge envelopes', async () => {
        const imagePath = createTempImage();
        const evaluate = createDraftEvaluate();
        const setFileInput = vi.fn().mockRejectedValue(new Error('Unknown action: set-file-input'));
        const page = createPageMock({ evaluate, setFileInput });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': imagePath,
        })).resolves.toEqual([{ status: 'draft saved', detail: '"测试草稿" (with cover)' }]);
        expect(setFileInput).toHaveBeenCalledOnce();
        expect(evaluate.mock.calls.some(([script]) => script.includes('var transfer = new DataTransfer()'))).toBe(true);
    });

    it('does not hide hard setFileInput failures behind the fallback', async () => {
        const imagePath = createTempImage();
        const evaluate = createDraftEvaluate();
        const page = createPageMock({
            evaluate,
            setFileInput: vi.fn().mockRejectedValue(new Error('No element found matching selector')),
        });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': imagePath,
        })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(evaluate.mock.calls.some(([script]) => script.includes('var transfer = new DataTransfer()'))).toBe(false);
    });

    it.each([
        ['new CDN image', { uploadReady: false }],
        ['selected cover', { coverSelected: false }],
        ['fresh save confirmation', { saveConfirmed: false }],
    ])('fails closed when it cannot prove the %s postcondition', async (_label, scenario) => {
        const imagePath = createTempImage();
        const page = createPageMock({ evaluate: createDraftEvaluate(scenario) });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': imagePath,
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps a rejected DataTransfer fallback to a typed failure', async () => {
        const imagePath = createTempImage();
        const page = createPageMock({
            evaluate: createDraftEvaluate({ fallbackOk: false }),
            setFileInput: vi.fn().mockRejectedValue(new Error('NotAllowedError: Not allowed')),
        });

        await expect(command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': imagePath,
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
