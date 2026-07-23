import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './create-draft.js';
import './create-sticker.js';
import './drafts.js';
import './search.js';

function createPageMock(overrides = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: overrides.evaluate ?? vi.fn().mockResolvedValue(undefined),
        setFileInput: vi.fn().mockResolvedValue(undefined),
    };
}

describe('weixin command registration', () => {
    it('registers create-draft and drafts commands', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        expect(values.find(c => c.site === 'weixin' && c.name === 'create-draft')).toBeDefined();
        expect(values.find(c => c.site === 'weixin' && c.name === 'create-sticker')).toBeDefined();
        const draftsCommand = values.find(c => c.site === 'weixin' && c.name === 'drafts');
        expect(draftsCommand).toBeDefined();
        expect(draftsCommand.args.find((arg) => arg.name === 'timeout')).toMatchObject({ type: 'int', default: 60 });
        expect(values.find(c => c.site === 'weixin' && c.name === 'search')).toBeDefined();
    });
});

describe('weixin create-sticker command', () => {
    it('opens the sticker editor and saves a sticker draft', async () => {
        const command = getRegistry().get('weixin/create-sticker');
        const imagePath = new URL('../../extension/icons/icon-16.png', import.meta.url).pathname;
        const page = createPageMock({
            evaluate: vi.fn().mockImplementation(async (code) => {
                if (code.includes('window.location.href.match')) return '123456';
                if (code.includes('filetransfer?action=upload_material')) return {
                    ok: true,
                    fileId: 456,
                    cdnUrl: 'https://mmbiz.qpic.cn/test.jpg',
                };
                if (code.includes('vm.innerList')) return { ok: true };
                if (code.includes('!!document.querySelector') && code.includes('.image-selector')) return true;
                if (code.includes('textarea#title')) return true;
                if (code.includes('.share-text__input .ProseMirror')) return true;
                if (code.includes('#js_submit')) return { ok: true };
                if (code.includes('保存成功')) return true;
                return undefined;
            }),
        });

        const result = await command.func(page, {
            image: imagePath,
            title: '贴图标题',
            content: '贴图描述',
        });

        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('createType=8'));
        expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('filetransfer?action=upload_material'));
        expect(page.setFileInput).not.toHaveBeenCalled();
        expect(result).toEqual([{ status: 'sticker draft saved', detail: '"贴图标题" (sticker)' }]);
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
