import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './publish.js';
const IMAGE_INPUT_SELECTOR_RESULT = 'input[type="file"][accept*="image"]';
function createPageMock(evaluateResults, overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
function createConditionalPageMock(evaluateImpl, overrides = {}) {
    const page = createPageMock([], overrides);
    page.evaluate.mockImplementation(async (js) => evaluateImpl(String(js)));
    return page;
}
describe('xiaohongshu publish', () => {
    it('keeps the positional content argument before named options', () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.args.map((arg) => arg.name)).toEqual([
            'content',
            'title',
            'images',
            'card-text',
            'card-style',
            'topics',
            'draft',
        ]);
    });

    it('uses native insertText for contenteditable title fields when available', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"verify"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, actual: '标题走原生输入' }
                    : { ok: true, actual: '正文也走原生输入' };
            }
            if (code.includes('(function(selectors, text)')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable', actual: '标题走原生输入' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable', actual: '正文也走原生输入' };
            }
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll'))
                return '发布成功';
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
        });
        const result = await cmd.func(page, {
            title: '标题走原生输入',
            content: '正文也走原生输入',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(insertText).toHaveBeenNthCalledWith(1, '标题走原生输入');
        expect(insertText).toHaveBeenNthCalledWith(2, '正文也走原生输入');
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"标题走原生输入" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('aborts when the title does not stick after filling', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"'))
                return { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"verify"'))
                return { ok: false, actual: '' };
            if (code.includes('(function(selectors, text)'))
                return { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable', actual: '' };
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll'))
                return '发布成功';
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
        });
        await expect(cmd.func(page, {
            title: '标题没写进去',
            content: '正文',
            images: imagePath,
            topics: '',
            draft: false,
        })).rejects.toThrow('Failed to set title');
        expect(insertText).toHaveBeenCalledWith('标题没写进去');
    });
    it('falls back to in-page insertion when contenteditable native insertText fails', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockRejectedValue(new Error('insertText returned no inserted flag'));
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, actual: '原生失败后回退' }
                    : { ok: true, actual: '正文也回退' };
            }
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll'))
                return '发布成功';
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
        });
        const result = await cmd.func(page, {
            title: '原生失败后回退',
            content: '正文也回退',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(insertText).toHaveBeenCalledWith('原生失败后回退');
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"原生失败后回退" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('aborts when an input title does not stick after filling', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"'))
                return code.includes('input[maxlength')
                    ? { ok: true, sel: 'input[maxlength="20"]', kind: 'input' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"'))
                return code.includes('input[maxlength')
                    ? { ok: false, actual: '' }
                    : { ok: true, actual: '正文' };
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll'))
                return '发布成功';
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        });
        await expect(cmd.func(page, {
            title: '输入框标题没写进去',
            content: '正文',
            images: imagePath,
            topics: '',
            draft: false,
        })).rejects.toThrow('Failed to set title');
    });
    it('prefers CDP setFileInput upload when the page supports it', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            'input[type="file"][accept*="image"],input[type="file"][accept*=".jpg"],input[type="file"][accept*=".jpeg"],input[type="file"][accept*=".png"],input[type="file"][accept*=".gif"],input[type="file"][accept*=".webp"]',
            false,
            true,
            { ok: true, sel: 'input[maxlength="20"]', kind: 'input' },
            { ok: true, actual: 'CDP上传优先' },
            { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' },
            { ok: true, actual: '优先走 setFileInput 主路径' },
            { ok: true, via: 'click', text: '发布' },
            'https://creator.xiaohongshu.com/publish/success',
            '发布成功',
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            title: 'CDP上传优先',
            content: '优先走 setFileInput 主路径',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(setFileInput).toHaveBeenCalledWith([imagePath], expect.stringContaining('input[type="file"][accept*="image"]'));
        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        expect(evaluateCalls.some((code) => code.includes('atob(img.base64)'))).toBe(false);
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"CDP上传优先" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('falls back to DataTransfer upload when CDP file injection is blocked by Chrome', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const setFileInput = vi.fn().mockRejectedValue(new Error('Chrome Not allowed'));
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            'input[type="file"][accept*="image"],input[type="file"][accept*=".jpg"],input[type="file"][accept*=".jpeg"],input[type="file"][accept*=".png"],input[type="file"][accept*=".gif"],input[type="file"][accept*=".webp"]',
            { ok: true, count: 1 },
            false,
            true,
            { ok: true, sel: 'input[maxlength="20"]', kind: 'input' },
            { ok: true, actual: 'CDP被拒后回退' },
            { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' },
            { ok: true, actual: 'DataTransfer fallback path' },
            { ok: true, via: 'click', text: '发布' },
            'https://creator.xiaohongshu.com/publish/success',
            '发布成功',
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            title: 'CDP被拒后回退',
            content: 'DataTransfer fallback path',
            images: imagePath,
            topics: '',
            draft: false,
        });
        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        expect(setFileInput).toHaveBeenCalledWith([imagePath], expect.stringContaining('input[type="file"][accept*="image"]'));
        expect(evaluateCalls.some((code) => code.includes('dt.items.add(new File'))).toBe(true);
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"CDP被拒后回退" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('fails fast when only a generic file input exists on the page', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            null,
        ], {
            setFileInput,
        });
        await expect(cmd.func(page, {
            title: '不要走泛化上传',
            content: 'generic file input 应该直接报错',
            images: imagePath,
            topics: '',
            draft: false,
        })).rejects.toThrow('Image injection failed: No file input found on page');
        expect(setFileInput).not.toHaveBeenCalled();
        expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/xhs_publish_upload_debug.png' });
    });
    it('selects the image-text tab and publishes successfully', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            { ok: true, count: 1 },
            false,
            true, // waitForEditForm: editor appeared
            { ok: true, sel: 'input[maxlength="20"]', kind: 'input' },
            { ok: true, actual: 'DeepSeek别乱问' },
            { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' },
            { ok: true, actual: '一篇真实一点的小红书正文' },
            { ok: true, via: 'click', text: '发布' },
            'https://creator.xiaohongshu.com/publish/success',
            '发布成功',
        ]);
        const result = await cmd.func(page, {
            title: 'DeepSeek别乱问',
            content: '一篇真实一点的小红书正文',
            images: imagePath,
            topics: '',
            draft: false,
        });
        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        const tabSelectCode = evaluateCalls.find((code) => code.includes("const targets = ['上传图文', '图文', '图片']"));
        expect(tabSelectCode).toBeTruthy();
        expect(tabSelectCode.indexOf('if (text === target)')).toBeLessThan(tabSelectCode.indexOf('text.startsWith(target)'));
        expect(evaluateCalls.some((code) => code.includes("No image file input found on page"))).toBe(true);
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('target=image'));
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"DeepSeek别乱问" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('uses the shadow-DOM method-invoke path when xhs-publish-btn handler succeeds', async () => {
        // Mirrors the previous "selects the image-text tab and publishes successfully"
        // mock sequence but returns `via: 'method', name: '_onPublish'` for the publish
        // trigger evaluate, exercising the shadow-DOM web-component handler path
        // (the primary #1606 fix). Without this case the fix's main path is uncovered.
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            { ok: true, count: 1 },
            false,
            true, // waitForEditForm: editor appeared
            { ok: true, sel: 'input[maxlength="20"]', kind: 'input' },
            { ok: true, actual: 'shadow-dom-test' },
            { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' },
            { ok: true, actual: '走 method-invoke 路径' },
            { ok: true, via: 'method', name: '_onPublish' }, // shadow-DOM handler success
            'https://creator.xiaohongshu.com/publish/success',
            '发布成功',
        ]);
        const result = await cmd.func(page, {
            title: 'shadow-dom-test',
            content: '走 method-invoke 路径',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"shadow-dom-test" · 1张图片 · 发布成功',
            },
        ]);
        // The publish-trigger evaluate must have been the shadow-DOM probe (contains
        // 'xhs-publish-btn'), not the legacy `button.click()` fallback alone.
        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        expect(evaluateCalls.some((code) => code.includes('xhs-publish-btn'))).toBe(true);
    });
    it('fails early with a clear error when still on the video page', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: false, visibleTexts: ['上传视频', '上传图文'] },
            { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
            { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
            { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
            { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
        ]);
        await expect(cmd.func(page, {
            title: 'DeepSeek别乱问',
            content: '一篇真实一点的小红书正文',
            images: imagePath,
            topics: '',
            draft: false,
        })).rejects.toThrow('Still on the video publish page after trying to select 图文');
        expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/xhs_publish_tab_debug.png' });
    });
    it('waits for the image-text surface to appear after clicking the tab', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createPageMock([
            'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
            { ok: true, target: '上传图文', text: '上传图文' },
            { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
            { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
            { ok: true, count: 1 }, // injectImages
            false, // waitForUploads: no progress indicator
            true, // waitForEditForm: editor appeared
            { ok: true, sel: 'input[maxlength="20"]', kind: 'input' },
            { ok: true, actual: '延迟切换也能过' },
            { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' },
            { ok: true, actual: '图文页切换慢一点也继续等' },
            { ok: true, via: 'click', text: '发布' },
            'https://creator.xiaohongshu.com/publish/success',
            '发布成功',
        ]);
        const result = await cmd.func(page, {
            title: '延迟切换也能过',
            content: '图文页切换慢一点也继续等',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(page.wait.mock.calls).toContainEqual([{ time: 0.5 }]);
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"延迟切换也能过" · 1张图片 · 发布成功',
            },
        ]);
    });
    it('treats 保存成功 on the draft list as a successful draft save', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][class*="content"]')
                    ? { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' }
                    : { ok: true, sel: 'input[placeholder*="标题"]', kind: 'input' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"')) {
                return code.includes('[contenteditable="true"][class*="content"]')
                    ? { ok: true, actual: '停留在发布页也算成功' }
                    : { ok: true, actual: '草稿成功提示' };
            }
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll')) {
                return code.includes('保存成功') ? '保存成功' : '';
            }
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        });
        const result = await cmd.func(page, {
            title: '草稿成功提示',
            content: '停留在发布页也算成功',
            images: imagePath,
            topics: '',
            draft: true,
        });
        expect(result).toEqual([
            {
                status: '✅ 暂存成功',
                detail: '"草稿成功提示" · 1张图片 · 保存成功',
            },
        ]);
    });
    it('fails when publish success cannot be verified', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('dt.items.add(new File'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][class*="content"]')
                    ? { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' }
                    : { ok: true, sel: 'input[placeholder*="标题"]', kind: 'input' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"')) {
                return code.includes('[contenteditable="true"][class*="content"]')
                    ? { ok: true, actual: '发布提示不该复用草稿成功' }
                    : { ok: true, actual: '发布成功提示' };
            }
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('labels.some'))
                return false;
            if (code.includes('for (const el of document.querySelectorAll')) {
                return code.includes('保存成功') ? '保存成功' : '';
            }
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        });
        await expect(cmd.func(page, {
            title: '发布成功提示',
            content: '发布提示不该复用草稿成功',
            images: imagePath,
            topics: '',
            draft: false,
        })).rejects.toThrow(CommandExecutionError);
    });
    it('attaches topics via Enter to accept the inline suggestion (shadow-DOM dropdown)', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockResolvedValue(undefined);
        const pressKey = vi.fn().mockResolvedValue(undefined);
        const focusCalls = [];
        // Track per-topic chip-marker evaluate calls: before selection, then
        // after Enter accepts the highlighted suggestion.
        let markerChecks = 0;
        // Skip the upload path entirely: page.setFileInput is a no-op for
        // these tests because the topic flow is what we care about.
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            // CDP setFileInput selector probe.
            if (code.includes('document.querySelector(sels)')) {
                return 'input[type="file"][accept*="image"]';
            }
            if (code.includes('const images =') && code.includes('dt.items.add(new File)'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            // Body-editor focus helper.
            if (code.includes('node.isContentEditable') && code.includes('selectNodeContents')) {
                focusCalls.push(true);
                return true;
            }
            // Body-scoped chip-marker postcondition. Each topic checks count
            // before and after Enter; simulate one new marker after selection.
            if (code.includes('__opencli_xhs_topic_marker_count')) {
                markerChecks += 1;
                return markerChecks % 2 === 1 ? 0 : 1;
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"verify"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, actual: '带话题的标题' }
                    : { ok: true, actual: '带话题的正文' };
            }
            if (code.includes('(function(selectors, text)')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable', actual: '带话题的标题' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable', actual: '带话题的正文' };
            }
            if (code.includes('labels.some'))
                return { ok: true, via: 'click', text: '发布' };
            if (code.includes('for (const el of document.querySelectorAll'))
                return '发布成功';
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
            pressKey,
            setFileInput,
        });
        const result = await cmd.func(page, {
            title: '带话题的标题',
            content: '带话题的正文',
            images: imagePath,
            topics: 'AI,效率提升',
            draft: false,
        });
        // Each topic is typed as "#<topic>" via page.insertText.
        expect(insertText).toHaveBeenCalledWith('#AI');
        expect(insertText).toHaveBeenCalledWith('#效率提升');
        // Body editor was focused once per topic before typing.
        expect(focusCalls.length).toBe(2);
        // pressKey was called at least twice per topic (separator + accept).
        const enterCount = pressKey.mock.calls.filter(args => args[0] === 'Enter').length;
        expect(enterCount).toBeGreaterThanOrEqual(4);
        // Chip-marker postcondition checked before and after each topic.
        expect(markerChecks).toBe(4);
        expect(result).toEqual([
            {
                status: '✅ 发布成功',
                detail: '"带话题的标题" · 1张图片 · 话题: AI 效率提升 · 发布成功',
            },
        ]);
    });
    it('fails typed when XHS does not render the topic chip marker after Enter', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockResolvedValue(undefined);
        const pressKey = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            // Base64 fallback (no setFileInput in the test page).
            if (code.includes('const images =') && code.includes('for (const img of images)'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('node.isContentEditable') && code.includes('selectNodeContents'))
                return true;
            // Chip marker count does not increase → topic attachment failed.
            if (code.includes('__opencli_xhs_topic_marker_count')) {
                return 0;
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"verify"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, actual: '话题失败标题' }
                    : { ok: true, actual: '话题失败正文' };
            }
            if (code.includes('(function(selectors, text)')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable', actual: '话题失败标题' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable', actual: '话题失败正文' };
            }
            if (code.includes('labels.some')) {
                throw new Error('publish button should not be clicked after topic postcondition failure');
            }
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
            pressKey,
        });

        await expect(cmd.func(page, {
            title: '话题失败标题',
            content: '话题失败正文',
            images: imagePath,
            topics: '不存在的话题',
            draft: false,
        })).rejects.toBeInstanceOf(CommandExecutionError);
        // We still typed and accepted the suggestion, but the postcondition
        // check rejected the result before the publish button was clicked.
        expect(insertText).toHaveBeenCalledWith('#不存在的话题');
        expect(pressKey).toHaveBeenCalledWith('Enter');
    });
    it('does not accept a pre-existing topic marker as proof of a new attached topic', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
        const imagePath = path.join(tempDir, 'demo.jpg');
        fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const insertText = vi.fn().mockResolvedValue(undefined);
        const pressKey = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('const images =') && code.includes('for (const img of images)'))
                return { ok: true, count: 1 };
            if (code.includes('[class*="upload"][class*="progress"]'))
                return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            if (code.includes('node.isContentEditable') && code.includes('selectNodeContents'))
                return true;
            // Existing marker before selection, but Enter does not attach a new
            // entity; count remains unchanged and must fail.
            if (code.includes('__opencli_xhs_topic_marker_count')) {
                return 1;
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable' };
            }
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"prepare"'))
                return { ok: true };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"verify"')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, actual: '已有话题标题' }
                    : { ok: true, actual: '已有话题正文 #AI[话题]' };
            }
            if (code.includes('(function(selectors, text)')) {
                return code.includes('[contenteditable="true"][placeholder*="标题"]')
                    ? { ok: true, sel: '[contenteditable="true"][placeholder*="标题"]', kind: 'contenteditable', actual: '已有话题标题' }
                    : { ok: true, sel: '[contenteditable="true"][class*="content"]', kind: 'contenteditable', actual: '已有话题正文 #AI[话题]' };
            }
            if (code.includes('labels.some')) {
                throw new Error('publish button should not be clicked after topic postcondition failure');
            }
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        }, {
            insertText,
            pressKey,
        });

        await expect(cmd.func(page, {
            title: '已有话题标题',
            content: '已有话题正文 #AI[话题]',
            images: imagePath,
            topics: 'AI',
            draft: false,
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('xiaohongshu publish 文字配图 validation', () => {
    const getCmd = () => getRegistry().get('xiaohongshu/publish');

    it('throws ArgumentError when neither --images nor --card-text is given', async () => {
        const cmd = getCmd();
        const page = createPageMock([]);
        await expect(
            cmd.func(page, { title: 't', content: 'c' })
        ).rejects.toThrow(/--images.*--card-text|--card-text.*--images/);
        await expect(
            cmd.func(page, { title: 't', content: 'c' })
        ).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects .gif appended images in text-image mode', async () => {
        const cmd = getCmd();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-cardgif-'));
        const gifPath = path.join(tempDir, 'a.gif');
        fs.writeFileSync(gifPath, Buffer.from([0x47, 0x49, 0x46]));
        const page = createPageMock([]);
        await expect(
            cmd.func(page, { title: 't', content: 'c', 'card-text': '文字', images: gifPath })
        ).rejects.toThrow(/gif/i);
        await expect(
            cmd.func(page, { title: 't', content: 'c', 'card-text': '文字', images: gifPath })
        ).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws ArgumentError for invalid image paths before navigating', async () => {
        const cmd = getCmd();
        const page = createPageMock([]);
        await expect(
            cmd.func(page, { title: 't', content: 'c', images: '/tmp/opencli-xhs-missing.jpg' })
        ).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws ArgumentError for unsupported image extensions before navigating', async () => {
        const cmd = getCmd();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-badext-'));
        const txtPath = path.join(tempDir, 'a.txt');
        fs.writeFileSync(txtPath, 'not an image');
        const page = createPageMock([]);
        await expect(
            cmd.func(page, { title: 't', content: 'c', images: txtPath })
        ).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('xiaohongshu publish 文字配图 flow', () => {
    const getCmd = () => getRegistry().get('xiaohongshu/publish');

    // Build a page mock that walks the full text-image happy path.
    function createTextImagePage({ insertText, capture }) {
        return createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'image_surface', hasTitleInput: false, hasImageInput: true, hasVideoSurface: false };
            // text-image entry click
            if (code.includes('__opencli_xhs_click_label')) {
                capture.clicks.push(code.match(/wantLabel:\s*"([^"]+)"/)?.[1] ?? 'unknown');
                return { ok: true };
            }
            // focus active card
            if (code.includes('__opencli_xhs_focus_card'))
                return { ok: true };
            // new-card render poll after 再写一张
            if (code.includes('__opencli_xhs_card_count'))
                return { ok: true, count: 9, activeEmpty: true };
            // 预览图片 step readiness poll after 生成图片
            if (code.includes('__opencli_xhs_preview_ready'))
                return { ok: true };
            // verify a card is non-empty
            if (code.includes('__opencli_xhs_card_text'))
                return { ok: true, text: 'non-empty' };
            // preview style options present — `found` mirrors the live reader,
            // which reports whether the requested style is among the on-page options.
            if (code.includes('__opencli_xhs_card_styles')) {
                const styles = ['基础', '插图', '美漫', '备忘', '边框', '清新'];
                const want = code.match(/const want = "([^"]+)"/)?.[1] ?? '';
                return { ok: true, styles, found: styles.includes(want) };
            }
            if (code.includes('__opencli_xhs_composer_media_count'))
                return { ok: true, count: 9 };
            // wait-for-edit-form poll
            if (code.includes('const sels =') && code.includes('for (const sel of sels)'))
                return true;
            // fill title/content locate+apply
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"'))
                return { ok: true, sel: 'x', kind: 'input' };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"'))
                return { ok: true, actual: code.includes('标题') ? 't' : 'c' };
            if (code.includes('xhs-publish-btn'))
                return { ok: true, via: 'method', name: '_onPublish' };
            if (code.includes('successMarkers') || code.includes('发布成功'))
                return '发布成功';
            return null;
        }, { insertText });
    }

    it('types one card, generates, and lands on the editor', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createTextImagePage({ insertText, capture });
        const rows = await cmd.func(page, { title: 't', content: 'c', 'card-text': '第一段卡片文字' });
        expect(insertText).toHaveBeenCalledWith('第一段卡片文字');
        expect(capture.clicks).toContain('文字配图');
        expect(capture.clicks).toContain('生成图片');
        expect(capture.clicks).toContain('下一步');
        const mediaCountCode = page.evaluate.mock.calls.map((args) => String(args[0]))
            .find((code) => code.includes('__opencli_xhs_composer_media_count'));
        expect(mediaCountCode).toContain('.find((el) => visibleBox(el))');
        expect(mediaCountCode).toContain('if (!visibleMedia(el)) continue');
        expect(rows[0].status).toContain('发布成功');
    });

    it('types multiple cards split by ||| and clicks 再写一张 between them', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createTextImagePage({ insertText, capture });
        await cmd.func(page, { title: 't', content: 'c', 'card-text': '卡片一|||卡片二|||卡片三' });
        expect(insertText.mock.calls.map((c) => c[0])).toEqual(['卡片一', '卡片二', '卡片三']);
        expect(capture.clicks.filter((c) => c === '再写一张')).toHaveLength(2);
    });

    it('splits a multi-line card on \\n and presses Enter between lines', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createTextImagePage({ insertText, capture });
        await cmd.func(page, { title: 't', content: 'c', 'card-text': '第一行\n第二行\n第三行' });
        // Each line is inserted separately, not as one "\n"-joined blob.
        expect(insertText.mock.calls.map((c) => c[0])).toEqual(['第一行', '第二行', '第三行']);
        // Two line breaks → two Enter presses inside the card editor.
        const enterCount = page.pressKey.mock.calls.filter((args) => args[0] === 'Enter').length;
        expect(enterCount).toBe(2);
    });

    it('treats a literal "\\n" (backslash-n from the shell) as a line break', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createTextImagePage({ insertText, capture });
        // Single-quoted shell args deliver the two chars backslash + n, not a real LF.
        await cmd.func(page, { title: 't', content: 'c', 'card-text': '第一行\\n第二行\\n第三行' });
        expect(insertText.mock.calls.map((c) => c[0])).toEqual(['第一行', '第二行', '第三行']);
        const enterCount = page.pressKey.mock.calls.filter((args) => args[0] === 'Enter').length;
        expect(enterCount).toBe(2);
    });

    it('keeps a single-line card on one insertText call (no Enter)', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createTextImagePage({ insertText, capture });
        await cmd.func(page, { title: 't', content: 'c', 'card-text': '只有一行' });
        expect(insertText.mock.calls.map((c) => c[0])).toEqual(['只有一行']);
        expect(page.pressKey.mock.calls.filter((args) => args[0] === 'Enter')).toHaveLength(0);
    });

    it('appends uploaded images after generating cards (text-image + images)', async () => {
        const cmd = getCmd();
        const insertText = vi.fn().mockResolvedValue(undefined);
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-cardimg-'));
        const jpg = path.join(tempDir, 'extra.jpg');
        fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        // base page walker + a file-input selector probe for uploadImages()
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'image_surface', hasTitleInput: false, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('__opencli_xhs_click_label')) return { ok: true };
            if (code.includes('__opencli_xhs_focus_card')) return { ok: true };
            if (code.includes('__opencli_xhs_card_count')) return { ok: true, count: 9, activeEmpty: true };
            if (code.includes('__opencli_xhs_preview_ready')) return { ok: true };
            if (code.includes('__opencli_xhs_card_text')) return { ok: true, text: 'x' };
            if (code.includes('__opencli_xhs_composer_media_count')) return { ok: true, count: 2 };
            if (code.includes('document.querySelector(sels)') && code.includes('return el ? sels : null')) return IMAGE_INPUT_SELECTOR_RESULT;
            if (code.includes('[class*="upload"][class*="progress"]')) return false;
            if (code.includes('const sels =') && code.includes('for (const sel of sels)')) return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) return { ok: true, sel: 'x', kind: 'input' };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"')) return { ok: true, actual: code.includes('标题') ? 't' : 'c' };
            if (code.includes('xhs-publish-btn')) return { ok: true, via: 'method', name: '_onPublish' };
            if (code.includes('successMarkers') || code.includes('发布成功')) return '发布成功';
            return null;
        }, { insertText, setFileInput });
        const rows = await cmd.func(page, { title: 't', content: 'c', 'card-text': '一段卡片', images: jpg });
        expect(setFileInput).toHaveBeenCalledTimes(1);
        expect(setFileInput.mock.calls[0][0]).toEqual([jpg]);
        expect(setFileInput.mock.calls[0][1]).toEqual(IMAGE_INPUT_SELECTOR_RESULT);
        expect(rows[0].detail).toContain('1张图片');
    });

    it('fails when a card stays empty after typing', async () => {
        const cmd = getCmd();
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href')) return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']")) return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'image_surface', hasTitleInput: false, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('__opencli_xhs_click_label')) return { ok: true };
            if (code.includes('__opencli_xhs_focus_card')) return { ok: true };
            if (code.includes('__opencli_xhs_card_count')) return { ok: true, count: 9, activeEmpty: true };
            if (code.includes('__opencli_xhs_preview_ready')) return { ok: true };
            if (code.includes('__opencli_xhs_card_text')) return { ok: false, text: '' }; // stays empty
            return null;
        }, { insertText });
        await expect(
            cmd.func(page, { title: 't', content: 'c', 'card-text': '内容' })
        ).rejects.toThrow(/empty after typing/);
    });

    it('selects a non-default card style on the preview step', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href'))
                return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']"))
                return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'image_surface', hasTitleInput: false, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('__opencli_xhs_click_label')) {
                capture.clicks.push(code.match(/wantLabel:\s*"([^"]+)"/)?.[1] ?? 'unknown');
                return { ok: true };
            }
            if (code.includes('__opencli_xhs_focus_card')) return { ok: true };
            if (code.includes('__opencli_xhs_card_count')) return { ok: true, count: 9, activeEmpty: true };
            if (code.includes('__opencli_xhs_preview_ready')) return { ok: true };
            if (code.includes('__opencli_xhs_card_text')) return { ok: true, text: 'x' };
            if (code.includes('__opencli_xhs_card_styles')) {
                const styles = ['基础', '插图', '美漫', '备忘', '边框', '清新'];
                const want = code.match(/const want = "([^"]+)"/)?.[1] ?? '';
                return { ok: true, styles, found: styles.includes(want) };
            }
            if (code.includes('__opencli_xhs_composer_media_count')) return { ok: true, count: 1 };
            if (code.includes('const sels =') && code.includes('for (const sel of sels)')) return true;
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"locate"')) return { ok: true, sel: 'x', kind: 'input' };
            if (code.includes('__opencli_xhs_fill_phase') && code.includes('"apply"')) return { ok: true, actual: code.includes('标题') ? 't' : 'c' };
            if (code.includes('xhs-publish-btn')) return { ok: true, via: 'method', name: '_onPublish' };
            if (code.includes('successMarkers') || code.includes('发布成功')) return '发布成功';
            return null;
        }, { insertText });
        const rows = await cmd.func(page, { title: 't', content: 'c', 'card-text': '卡片', 'card-style': '边框' });
        expect(capture.clicks).toContain('边框');
        expect(rows[0].detail).toContain('(边框)');
    });

    it('fails when the requested style is not on the page', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        // createTextImagePage reports styles 基础/插图/美漫/备忘/边框/清新 — "霓虹" is absent.
        const page = createTextImagePage({ insertText, capture });
        await expect(
            cmd.func(page, { title: 't', content: 'c', 'card-text': '卡片', 'card-style': '霓虹' })
        ).rejects.toThrow(CommandExecutionError);
        expect(capture.clicks).not.toContain('霓虹');
    });

    it('fails when generated cards do not appear as composer media', async () => {
        const cmd = getCmd();
        const capture = { clicks: [] };
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = createConditionalPageMock((code) => {
            if (code.includes('location.href')) return 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
            if (code.includes("const targets = ['上传图文', '图文', '图片']")) return { ok: true, target: '上传图文', text: '上传图文' };
            if (code.includes('hasTitleInput') && code.includes('hasVideoSurface'))
                return { state: 'image_surface', hasTitleInput: false, hasImageInput: true, hasVideoSurface: false };
            if (code.includes('__opencli_xhs_click_label')) {
                capture.clicks.push(code.match(/wantLabel:\s*"([^"]+)"/)?.[1] ?? 'unknown');
                return { ok: true };
            }
            if (code.includes('__opencli_xhs_focus_card')) return { ok: true };
            if (code.includes('__opencli_xhs_card_count')) return { ok: true, count: 9, activeEmpty: true };
            if (code.includes('__opencli_xhs_preview_ready')) return { ok: true };
            if (code.includes('__opencli_xhs_card_text')) return { ok: true, text: 'x' };
            if (code.includes('__opencli_xhs_composer_media_count')) return { ok: true, count: 0 };
            if (code.includes('const sels =') && code.includes('for (const sel of sels)')) return true;
            return null;
        }, { insertText });

        await expect(
            cmd.func(page, { title: 't', content: 'c', 'card-text': '卡片' })
        ).rejects.toThrow(/generated images/);
    });
});
