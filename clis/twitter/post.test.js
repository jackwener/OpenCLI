import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError } from '@jackwener/opencli/errors';
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
        readFileSync: vi.fn(() => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
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

    it('typed-fails when text area not found', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' },
        ]);

        await expect(command.func(page, { text: 'hello' })).rejects.toBeInstanceOf(CommandExecutionError);
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

    it('throws on unsupported media format', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'photo.bmp' })).rejects.toThrow('Unsupported media format');
    });

    it('throws when a video is mixed with images', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'clip.mp4,a.png' })).rejects.toThrow('Cannot mix a video with images');
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws when more than one video is attached', async () => {
        const command = getCommand();
        const page = makePage();
        await expect(command.func(page, { text: 'hi', images: 'a.mp4,b.mov' })).rejects.toThrow('Too many videos: 2 (max 1)');
    });

    it('uploads a video through the native file input', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ]);

        const result = await command.func(page, { text: 'with video', images: 'clip.mp4', timeout: 240 });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'with video' }]);
        expect(page.setFileInput).toHaveBeenCalledWith(['/abs/clip.mp4'], 'input[type="file"][data-testid="fileInput"]');
        // A video must never be read into memory and embedded in page JS.
        for (const [script] of page.evaluate.mock.calls) {
            expect(script).not.toContain('atob(');
        }
    });

    it('falls back to the shared upload primitive for video, never to base64', async () => {
        const command = getCommand();
        const uploadFiles = vi.fn().mockResolvedValue({ ok: true });
        const page = makePage([
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput: undefined, uploadFiles });

        await command.func(page, { text: 'with video', images: 'clip.mp4', timeout: 240 });

        expect(uploadFiles).toHaveBeenCalledWith('input[type="file"][data-testid="fileInput"]', ['/abs/clip.mp4']);
        for (const [script] of page.evaluate.mock.calls) {
            expect(script).not.toContain('atob(');
        }
    });

    it('keeps the image base64 fallback when the shared primitive fails', async () => {
        const command = getCommand();
        const uploadFiles = vi.fn().mockRejectedValue(new Error('not supported'));
        const page = makePage([
            { ok: true }, // DataTransfer fallback
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput: undefined, uploadFiles });

        await command.func(page, { text: 'with image', images: 'a.png' });

        expect(uploadFiles).toHaveBeenCalled();
        expect(page.evaluate.mock.calls[0][0]).toContain('atob(');
    });

    it('surfaces the native failure for video instead of falling back to base64', async () => {
        const command = getCommand();
        const uploadFiles = vi.fn().mockRejectedValue(new Error('DOM.setFileInputFiles failed'));
        const page = makePage([], { setFileInput: undefined, uploadFiles });

        await expect(command.func(page, { text: 'with video', images: 'clip.mp4', timeout: 240 }))
            .rejects.toThrow('DOM.setFileInputFiles failed');
        for (const [script] of page.evaluate.mock.calls) {
            expect(script).not.toContain('atob(');
        }
    });

    it('refuses a video when the backend has no native file input', async () => {
        const command = getCommand();
        const page = makePage([], { setFileInput: undefined });

        await expect(command.func(page, { text: 'with video', images: 'clip.mp4', timeout: 240 }))
            .rejects.toThrow('Video upload needs a backend with native file-input support');
    });

    it('still uses the base64 composer fallback for images', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // DataTransfer fallback
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput: undefined });

        await command.func(page, { text: 'with image', images: 'a.png' });

        expect(page.evaluate.mock.calls[0][0]).toContain('atob(');
    });

    it('falls back to DataTransfer upload when page.setFileInput is not available', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // DataTransfer fallback
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput: undefined });

        const result = await command.func(page, { text: 'hi', images: 'a.png' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'hi' }]);
        expect(page.evaluate.mock.calls[0][0]).toContain('new DataTransfer()');
        expect(page.evaluate.mock.calls[0][0]).toContain('Could not assign files to input');
    });

    it('falls back to DataTransfer upload when CDP rejects file input as not allowed', async () => {
        const command = getCommand();
        const setFileInput = vi.fn().mockRejectedValue(new Error('NotAllowedError: Not allowed'));
        const page = makePage([
            { ok: true }, // DataTransfer fallback
            { ok: true, previewCount: 1 }, // upload polling
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput });

        const result = await command.func(page, { text: 'with fallback', images: 'a.png' });

        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'with fallback' }]);
        expect(setFileInput).toHaveBeenCalledWith(['/abs/a.png'], 'input[type="file"][data-testid="fileInput"]');
        expect(page.evaluate.mock.calls[0][0]).toContain('new DataTransfer()');
    });

    it('falls back to DataTransfer when the file-chooser event times out', async () => {
        const command = getCommand();
        const setFileInput = vi.fn().mockRejectedValue(new Error(
            'Page.fileChooserOpened not received within 5s — the input may not have opened a file chooser',
        ));
        const page = makePage([
            { ok: true }, // DataTransfer fallback
            { ok: true, previewCount: 1 }, // image preview ready
            { ok: true }, // focus composer
            { ok: true }, // verify native insertion
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ], { setFileInput });

        const result = await command.func(page, { text: 'image + text', images: 'a.png' });
        expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'image + text' }]);
        expect(setFileInput).toHaveBeenCalledWith(['/abs/a.png'], 'input[type="file"][data-testid="fileInput"]');
        expect(page.evaluate.mock.calls[0][0]).toContain('new DataTransfer()');
        expect(page.insertText).toHaveBeenCalledWith('image + text');
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

    // The compose route is a modal over the home timeline. The helper stubs the
    // pre-submit steps but runs click + submit polling against a real DOM.
    const runPostAgainstDom = async (html, text, { afterClickHtml = '' } = {}) => {
        const dom = new JSDOM(`<!doctype html><body><button data-testid="tweetButton">Post</button>${html}</body>`, {
            url: 'https://x.com/compose/post',
            runScripts: 'outside-only',
        });
        dom.window.setTimeout = (callback) => {
            callback();
            return 0;
        };
        dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
        const page = makePage([]);
        let evaluateCount = 0;
        page.evaluate.mockImplementation((script) => {
            evaluateCount += 1;
            if (evaluateCount <= 2) return Promise.resolve({ ok: true });
            if (evaluateCount === 3) {
                const result = dom.window.eval(script);
                if (afterClickHtml) {
                    dom.window.document.body.insertAdjacentHTML('beforeend', afterClickHtml);
                }
                return Promise.resolve(result);
            }
            return Promise.resolve(dom.window.eval(script));
        });
        return getCommand().func(page, { text });
    };

    it('does not report success from a cleared composer and a timeline permalink', async () => {
        const timelineOnly = '<article><a href="/nasa/status/1111111111111111111">someone else</a></article>';

        await expect(runPostAgainstDom(timelineOnly, 'cleared composer')).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('Tweet submission did not complete before timeout.'),
        });
    });

    it('keeps the permalink that the success toast carries', async () => {
        const timeline = '<article><a href="/nasa/status/1111111111111111111">someone else</a></article>';
        const toast = `
            <article><a href="/nasa/status/1111111111111111111">someone else</a></article>
            <div role="alert">Your post was sent. <a href="/me/status/2222222222222222222">View</a></div>
        `;

        await expect(runPostAgainstDom(timeline, 'toast permalink', { afterClickHtml: toast })).resolves.toEqual([
            {
                status: 'success',
                message: 'Tweet posted successfully.',
                text: 'toast permalink',
                id: '2222222222222222222',
                url: 'https://x.com/me/status/2222222222222222222',
            },
        ]);
    });

    it('recognizes a Chinese success toast and keeps its status permalink', async () => {
        const toast = '<div role="alert">你的帖子已发送。 <a href="/me/status/2222222222222222222">查看</a></div>';
        await expect(runPostAgainstDom('', '中文发布', { afterClickHtml: toast })).resolves.toEqual([{
            status: 'success',
            message: 'Tweet posted successfully.',
            text: '中文发布',
            id: '2222222222222222222',
            url: 'https://x.com/me/status/2222222222222222222',
        }]);
    });

    it('rejects an English failure toast instead of matching the substring "sent"', async () => {
        const toast = '<div role="alert">Your post was not sent. Try again.</div>';
        await expect(runPostAgainstDom('', 'not sent', { afterClickHtml: toast }))
            .rejects.toThrow('Your post was not sent');
    });

    it('rejects a Chinese failure toast', async () => {
        const toast = '<div role="alert">发送失败，请重试</div>';
        await expect(runPostAgainstDom('', '发送失败', { afterClickHtml: toast }))
            .rejects.toThrow('发送失败');
    });

    it('does not accept unrelated toast text containing "sent"', async () => {
        const toast = '<div role="alert">Message sent.</div>';
        await expect(runPostAgainstDom('', 'unrelated notification', { afterClickHtml: toast }))
            .rejects.toMatchObject({ name: 'TimeoutError', code: 'TIMEOUT' });
    });

    it('does not export a permalink from an untrusted toast link host', async () => {
        const toast = `
            <div role="alert">Your post was sent. <a href="https://example.com/me/status/2222222222222222222">View</a></div>
        `;

        await expect(runPostAgainstDom('', 'bad host', { afterClickHtml: toast })).resolves.toEqual([
            { status: 'success', message: 'Tweet posted successfully.', text: 'bad host' },
        ]);
    });

    it('ignores a success toast that existed before clicking post', async () => {
        const oldToast = `
            <div role="alert">Your post was sent. <a href="/me/status/3333333333333333333">View</a></div>
        `;

        await expect(runPostAgainstDom(oldToast, 'old toast')).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('Tweet submission did not complete before timeout.'),
        });
    });

    it('unwraps Browser Bridge envelopes for action results', async () => {
        const command = getCommand();
        const page = makePage([
            { session: 'site:twitter', data: { ok: true } },
            { session: 'site:twitter', data: { ok: true } },
            { session: 'site:twitter', data: { ok: true } },
            {
                session: 'site:twitter',
                data: {
                    ok: true,
                    message: 'Tweet posted successfully.',
                    id: '4444444444444444444',
                    url: 'https://x.com/me/status/4444444444444444444',
                },
            },
        ]);

        await expect(command.func(page, { text: 'wrapped' })).resolves.toEqual([
            {
                status: 'success',
                message: 'Tweet posted successfully.',
                text: 'wrapped',
                id: '4444444444444444444',
                url: 'https://x.com/me/status/4444444444444444444',
            },
        ]);
    });

    it('fails closed when submit completion returns only an id', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, message: 'Tweet posted successfully.', id: '5555555555555555555' },
        ]);

        await expect(command.func(page, { text: 'bad pair' })).rejects.toThrow('only one of id/url');
    });

    it('fails closed when submit completion returns a non-string id', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, message: 'Tweet posted successfully.', id: 5555555555555555, url: 'https://x.com/me/status/5555555555555555' },
        ]);

        await expect(command.func(page, { text: 'bad id type' })).rejects.toThrow('malformed status id');
    });

    it('fails closed when submit completion returns an untrusted status URL', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: true },
            {
                ok: true,
                message: 'Tweet posted successfully.',
                id: '6666666666666666666',
                url: 'https://example.com/me/status/6666666666666666666',
            },
        ]);

        await expect(command.func(page, { text: 'bad url host' })).rejects.toThrow('malformed status url');
    });

    it('fails closed when submit completion returns a mismatched status id/url', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: true },
            {
                ok: true,
                message: 'Tweet posted successfully.',
                id: '7777777777777777777',
                url: 'https://x.com/me/status/8888888888888888888',
            },
        ]);

        await expect(command.func(page, { text: 'mismatched pair' })).rejects.toThrow('malformed status url');
    });

    it('requires an explicit root for the permalink lookup', async () => {
        const command = getCommand();
        const page = makePage([{ ok: true }, { ok: true }, { ok: true }, { ok: true, message: 'Tweet posted successfully.' }]);

        await command.func(page, { text: 'explicit root' });

        expect(page.evaluate.mock.calls[3][0]).toContain('const statusUrl = (root) =>');
    });

    it('does not let global timeline tweetPhoto nodes keep the submit poll pending', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: true, message: 'Tweet posted successfully.' },
        ]);

        await command.func(page, { text: 'global media should not block' });

        const submitScript = page.evaluate.mock.calls[3][0];
        expect(submitScript).not.toContain("[data-testid=\"attachments\"], [data-testid=\"tweetPhoto\"]");
        expect(submitScript).not.toContain("document.querySelectorAll('[data-testid=\"tweetPhoto\"]");
        expect(submitScript).toContain('data-opencli-before-submit-toast');
    });

    it('typed-fails when media upload times out', async () => {
        const command = getCommand();
        const page = makePage();
        page.evaluate.mockResolvedValue({ ok: false, previewCount: 0 });

        await expect(command.func(page, { text: 'timeout', images: 'a.png', timeout: 40 })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
        expect(page.insertText).not.toHaveBeenCalled();
    });

    // The advertised wait has to be one the transport can actually deliver:
    // direct CDP rejects a Runtime.evaluate after 30s and the Browser Bridge
    // daemon closes a command at 120s, so the poll runs from Node -- one
    // instantaneous check per evaluate -- and its budget comes from --timeout.
    it('polls from Node so no single evaluate carries the upload deadline', async () => {
        const command = getCommand();
        const page = makePage();
        let polls = 0;
        page.evaluate.mockImplementation(async (script) => {
            if (!script.includes('Twitter') && script.includes('previewCount')) {
                polls += 1;
                return polls >= 3 ? { ok: true, previewCount: 1 } : { ok: false, previewCount: 0 };
            }
            return { ok: true, message: 'Tweet posted successfully.' };
        });

        await command.func(page, { text: 'slow upload', images: 'clip.mp4', timeout: 240 });

        expect(polls).toBe(3);
        // Each poll is a plain synchronous check: no in-page sleep loop.
        const pollScript = page.evaluate.mock.calls.find(([s]) => s.includes('previewCount'))[0];
        expect(pollScript).not.toContain('setTimeout');
        expect(pollScript).not.toContain('Media upload timed out');
        // The pacing sleep happens on the Node side instead.
        expect(page.wait).toHaveBeenCalledWith(0.5);
    });

    it('derives the upload budget from --timeout and says so when video runs out', async () => {
        const command = getCommand();
        const page = makePage();
        page.evaluate.mockResolvedValue({ ok: false, previewCount: 0 });

        // 60s command budget minus the 30s reserved for compose/submit.
        await expect(command.func(page, { text: 'slow', images: 'clip.mp4', timeout: 60 })).rejects.toMatchObject({
            name: 'TimeoutError',
            message: expect.stringContaining('30'),
            hint: expect.stringContaining('--timeout'),
        });
    });

    it('typed-fails with a non-zero exit code when the post never goes out', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: false, message: 'Tweet button is disabled or not found.' },
        ]);

        await expect(command.func(page, { text: 'never sent' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Tweet button is disabled or not found.',
            hint: expect.stringContaining('Nothing was posted'),
        });
    });

    it('reports an unconfirmed submit as temporary, without claiming nothing was posted', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // focus composer
            { ok: true }, // verify native insertText
            { ok: true }, // click post
            { ok: false, unconfirmed: true, message: 'Tweet submission did not complete before timeout.' },
        ]);

        await expect(command.func(page, { text: 'unconfirmed' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('may already be live'),
        });
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
