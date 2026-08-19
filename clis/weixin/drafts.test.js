import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './create-draft.js';
import './drafts.js';
import './search.js';

function createPageMock(overrides = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: overrides.evaluate ?? vi.fn().mockResolvedValue(undefined),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        nativeClick: vi.fn().mockResolvedValue(undefined),
    };
}

describe('weixin command registration', () => {
    it('registers create-draft and drafts commands', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        const createDraftCommand = values.find(c => c.site === 'weixin' && c.name === 'create-draft');
        expect(createDraftCommand).toBeDefined();
        expect(createDraftCommand.args.find((arg) => arg.name === 'original-declaration')).toBeDefined();
        expect(createDraftCommand.args.find((arg) => arg.name === 'reward')).toMatchObject({ type: 'bool', default: false });
        expect(createDraftCommand.args.find((arg) => arg.name === 'reward-account')).toBeDefined();
        expect(createDraftCommand.args.find((arg) => arg.name === 'collection')).toBeUndefined();
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

describe('weixin create-draft command', () => {
    it('uploads the cover separately and confirms the crop dialog', async () => {
        const command = getRegistry().get('weixin/create-draft');
        const evaluate = vi.fn().mockImplementation(async (script) => {
            if (script.includes('window.location.href.match')) return '123456';
            if (script.includes('!!document.querySelector("textarea#title")')) return true;
            if (script.includes("reason: 'content editor not found'")) return { ok: true };
            if (script.includes('var range = document.createRange()')) return true;
            if (script.includes('var imageSelector =') && script.includes('errorText')) return { ok: true, cdnCount: 1 };
            if (script.includes('return { ok: images.length > 0')) return { ok: true, count: 1 };
            if (script.includes('return { count: editor ?')) return { count: 1 };
            if (script.includes("['dragenter', 'dragover', 'drop']")) return true;
            if (script.includes("var area = document.querySelector('#js_cover_area')")) return false;
            if (script.includes("text === '完成' || text === '确认'")) return '完成';
            if (script.includes('var dialogText = "编辑封面"')) return { ok: true };
            if (script.includes('getBoundingClientRect()') && script.includes('data-opencli-target')) return { x: 20, y: 30 };
            if (script.includes("includes('编辑封面')")) return true;
            if (script.includes("=== '保存为草稿'")) return { ok: true };
            if (script.includes("document.querySelector('#js_save_success')")) return true;
            if (script.includes('var el = document.querySelector')) return { ok: true };
            return undefined;
        });
        const page = createPageMock({ evaluate });

        const result = await command.func(page, {
            title: '测试草稿',
            content: '测试正文',
            'cover-image': new URL('../../package.json', import.meta.url).pathname,
            reward: false,
        });

        expect(page.setFileInput).toHaveBeenCalledOnce();
        expect(page.nativeClick).toHaveBeenCalledWith(20, 30);
        expect(result).toEqual([{ status: 'draft saved', detail: '"测试草稿" (with cover)' }]);
    });
});
