import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './publish.js';
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
            if (code.includes('labels.some'))
                return true;
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
            if (code.includes('labels.some'))
                return true;
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
            if (code.includes('labels.some'))
                return true;
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
            if (code.includes('labels.some'))
                return true;
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
            true,
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
            true,
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
            true,
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
            true,
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
            if (code.includes('labels.some'))
                return true;
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
    it('does not treat 保存成功 alone as a publish success signal', async () => {
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
            if (code.includes('labels.some'))
                return true;
            if (code.includes('for (const el of document.querySelectorAll')) {
                return code.includes('保存成功') ? '保存成功' : '';
            }
            throw new Error(`Unhandled evaluate call: ${code.slice(0, 120)}`);
        });
        const result = await cmd.func(page, {
            title: '发布成功提示',
            content: '发布提示不该复用草稿成功',
            images: imagePath,
            topics: '',
            draft: false,
        });
        expect(result).toEqual([
            {
                status: '⚠️ 操作完成，请在浏览器中确认',
                detail: '"发布成功提示" · 1张图片 · https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image',
            },
        ]);
    });
});
