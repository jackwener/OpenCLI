import { JSDOM } from 'jsdom';
import { describe, it, expect, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        statSync: vi.fn((input) => {
            const value = String(input);
            if (value.includes('missing')) return undefined;
            return { isFile: () => !value.includes('directory') };
        }),
    };
});

vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolve: vi.fn((input) => `/abs/${input}`),
        extname: vi.fn((input) => {
            const match = String(input).match(/\.[^.]+$/);
            return match ? match[0] : '';
        }),
    };
});

import { __test__, publishCommand } from './publish.js';

function makePage({ evaluateResults = [], overrides = {} } = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    evaluate.mockResolvedValue({ ok: false, reason: 'unknown-state' });

    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        setFileInput: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue('https://www.goofish.com/publish'),
        ...overrides,
    };
}

async function runBrowserScript(html, script, { url = 'https://www.goofish.com/publish' } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

const validArgs = {
    title: 'MacBook Pro',
    description: '成色很好，功能正常',
    price: '5999.99',
    condition: '轻微使用',
    category: '笔记本',
};

describe('xianyu/publish', () => {
    it('builds the goofish publish URL', () => {
        expect(__test__.buildPublishUrl()).toBe('https://www.goofish.com/publish');
    });

    it('validates publish arguments before navigation', async () => {
        const page = makePage();

        await expect(publishCommand.func(page, { ...validArgs, title: '   ' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, price: '0' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, price: '12.345' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, condition: '八成新' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, images: 'a.bmp' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, images: 'missing.png' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(publishCommand.func(page, { ...validArgs, images: '1.png,2.png,3.png,4.png,5.png,6.png,7.png,8.png,9.png,10.png' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('publishes when every UI step has positive proof', async () => {
        const page = makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: true, filled: ['title', 'description', 'price', 'condition'], missing: [] },
                { ok: true },
                { status: 'published', item_id: '123456789012', url: 'https://www.goofish.com/item?id=123456789012' },
            ],
        });

        const rows = await publishCommand.func(page, validArgs);

        expect(rows).toEqual([{
            status: 'published',
            item_id: '123456789012',
            title: 'MacBook Pro',
            price: '¥5999.99',
            condition: '轻微使用',
            url: 'https://www.goofish.com/item?id=123456789012',
            message: '发布成功',
        }]);
    });

    it('uses IPage getCurrentUrl instead of a non-existent page.url method', async () => {
        const page = makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: true, filled: ['title', 'description', 'price', 'condition'], missing: [] },
                { ok: true },
                { status: 'published', item_id: '123456789012' },
            ],
            overrides: {
                getCurrentUrl: vi.fn().mockResolvedValue('https://www.goofish.com/item?id=123456789012'),
            },
        });

        expect(page.url).toBeUndefined();

        const rows = await publishCommand.func(page, validArgs);

        expect(page.getCurrentUrl).toHaveBeenCalled();
        expect(rows[0].url).toBe('https://www.goofish.com/item?id=123456789012');
    });

    it('maps login walls to AuthRequiredError', async () => {
        const page = makePage({
            evaluateResults: [
                { requiresAuth: true },
            ],
        });

        await expect(publishCommand.func(page, validArgs)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails fast when category selection or form filling is not proven', async () => {
        await expect(publishCommand.func(makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: false, reason: 'category-not-found' },
            ],
        }), validArgs)).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(publishCommand.func(makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: false, missing: ['price'] },
            ],
        }), validArgs)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('uploads validated local images through the discovered file input', async () => {
        const page = makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: true, missing: [] },
                { ok: true, selector: '[id="upload"]' },
                { ok: true },
                { status: 'published', item_id: '123456789012', url: 'https://www.goofish.com/item?id=123456789012' },
            ],
        });

        await publishCommand.func(page, { ...validArgs, images: 'a.png,b.webp' });

        expect(page.setFileInput).toHaveBeenCalledWith(['/abs/a.png', '/abs/b.webp'], '[id="upload"]');
    });

    it('does not return a success row for failed or unconfirmed publish states', async () => {
        await expect(publishCommand.func(makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: true, missing: [] },
                { ok: true },
                { status: 'failed', message: '内容违规' },
            ],
        }), validArgs)).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(publishCommand.func(makePage({
            evaluateResults: [
                { hasPublishForm: true },
                { ok: true },
                { ok: true, missing: [] },
                { ok: true },
            ],
        }), validArgs)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('browser category script is async and returns typed failure reasons', async () => {
        const result = await runBrowserScript('<main><button>其他</button></main>', __test__.buildSelectCategoryEvaluate('笔记本'));

        expect(result).toEqual({ ok: false, reason: 'category-trigger-not-found' });
    });

    it('browser fill script reports missing required fields', async () => {
        const result = await runBrowserScript(`
            <main>
              <input placeholder="标题" />
              <textarea id="desc"></textarea>
              <button>轻微使用</button>
            </main>
        `, __test__.buildFillFormEvaluate(validArgs));

        expect(result.ok).toBe(false);
        expect(result.missing).toContain('price');
    });

    it('browser success detector distinguishes success from failure and unknown states', async () => {
        await expect(runBrowserScript('<body>发布成功</body>', __test__.buildDetectSuccessEvaluate(), {
            url: 'https://www.goofish.com/item?id=123456789012',
        })).resolves.toMatchObject({ status: 'published', item_id: '123456789012' });

        await expect(runBrowserScript('<body><div class="error">内容违规</div></body>', __test__.buildDetectSuccessEvaluate()))
            .resolves.toMatchObject({ status: 'failed', message: '内容违规' });

        await expect(runBrowserScript('<body>处理中</body>', __test__.buildDetectSuccessEvaluate()))
            .resolves.toEqual({ ok: false, reason: 'unknown-state' });
    });
});
