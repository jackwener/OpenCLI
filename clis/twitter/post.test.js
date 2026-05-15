import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './post.js';

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        statSync: vi.fn((p, _opts) => {
            if (String(p).includes('missing'))
                return undefined;
            return { isFile: () => true };
        }),
    };
});

vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolve: vi.fn((p) => `/abs/${p}`),
        extname: vi.fn((p) => {
            const m = p.match(/\.[^.]+$/);
            return m ? m[0] : '';
        }),
    };
});

function makePage(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    evaluate.mockResolvedValue({ ok: true });

    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        setFileInput: vi.fn().mockResolvedValue(undefined),
        insertText: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('twitter post command', () => {
    const getCommand = () => getRegistry().get('twitter/post');

    it('registers created tweet id/url columns', () => {
        const command = getCommand();
        expect(command?.columns).toEqual(['status', 'message', 'text', 'id', 'url']);
    });

    it('posts text-only tweet successfully through the current compose route', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' }, // verify submit completed
        ]);

        const result = await command.func(page, { text: 'hello world' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'hello world' }]);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(page.insertText).toHaveBeenCalledWith('hello world');
    });

    it('returns the created tweet URL from the success toast when available', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: true },
            {
                ok: true,
                message: 'Tweet posted successfully.',
                id: '2054239044884693381',
                url: 'https://x.com/darthjajaj6z/status/2054239044884693381',
            },
        ]);

        const result = await command.func(page, { text: 'with url' });

        expect(result).toEqual([{
            status: 'success',
            message: 'Tweet posted successfully.',
            text: 'with url',
            id: '2054239044884693381',
            url: 'https://x.com/darthjajaj6z/status/2054239044884693381',
        }]);
    });

    it('returns failed when text area not found', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' },
        ]);

        const result = await command.func(page, { text: 'hello' });

        expect(result).toEqual([{ status: 'failed', message: 'Could not find the tweet composer text area. Are you logged in?', text: 'hello' }]);
        expect(page.insertText).not.toHaveBeenCalled();
    });

    it('throws when more than 4 images', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'a.png,b.png,c.png,d.png,e.png' })).rejects.toThrow('Too many images: 5 (max 4)');
    });

    it('throws when image file does not exist', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'missing.png' })).rejects.toThrow('Not a valid file');
    });

    it('throws on unsupported image format', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'photo.bmp' })).rejects.toThrow('Unsupported image format');
    });

    it('throws when page.setFileInput is not available', async () => {
        const command = getCommand();
        const page = makePage([], { setFileInput: undefined });
        await expect(command.func(page, { text: 'hi', images: 'a.png' })).rejects.toThrow('Browser extension does not support file upload');
    });

    it('uploads images before inserting text so media re-renders cannot erase the tweet text', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true, previewCount: 2 }, // upload polling returns true
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' }, // verify submit completed
        ]);

        const result = await command.func(page, { text: 'with images', images: 'a.png,b.png' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'with images' }]);
        expect(page.wait).toHaveBeenNthCalledWith(2, { selector: 'input[type="file"][data-testid="fileInput"]', timeout: 20 });
        expect(page.setFileInput).toHaveBeenCalledWith(['/abs/a.png', '/abs/b.png'], 'input[type="file"][data-testid="fileInput"]');
        expect(page.insertText).toHaveBeenCalledWith('with images');
        expect(page.setFileInput.mock.invocationCallOrder[0]).toBeLessThan(page.insertText.mock.invocationCallOrder[0]);

        const uploadScript = page.evaluate.mock.calls[0][0];
        expect(uploadScript).toContain('[data-testid="attachments"]');
        expect(uploadScript).toContain('buttonReady');
    });

    it('prefers nativeType when available because bridge insert-text can miss Draft.js after media upload', async () => {
        const command = getCommand();
        const nativeType = vi.fn().mockResolvedValue(undefined);
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify nativeType
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { nativeType });

        const result = await command.func(page, { text: 'native type' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'native type' }]);
        expect(nativeType).toHaveBeenCalledWith('native type');
        expect(page.insertText).not.toHaveBeenCalled();
    });

    it('treats X success toast as completed even if stale composer nodes remain', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' }, // verify submit completed
        ]);

        await command.func(page, { text: 'toast success' });

        const submitScript = page.evaluate.mock.calls[3][0];
        expect(submitScript).toContain('successToast');
        expect(submitScript).toContain('your post was sent');
    });

    it('returns failed when image upload times out', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: false, message: 'Image upload timed out (30s).' },
        ]);

        const result = await command.func(page, { text: 'timeout', images: 'a.png' });

        expect(result).toEqual([{ status: 'failed', message: 'Image upload timed out (30s).', text: 'timeout' }]);
        expect(page.insertText).not.toHaveBeenCalled();
    });

    it('falls back to DOM insertion when native insertText is unavailable', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // fallback DOM insertion
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { insertText: undefined });

        const result = await command.func(page, { text: 'fallback text' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'fallback text' }]);
        expect(page.evaluate.mock.calls[1][0]).toContain("execCommand('insertText'");
    });

    it('validates images before navigating to compose page', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'missing.png' })).rejects.toThrow('Not a valid file');
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws when no browser session', async () => {
        const command = getCommand();
        await expect(command.func(null, { text: 'hi' })).rejects.toThrow('Browser session required for twitter post');
    });
});
