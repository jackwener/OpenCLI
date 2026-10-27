import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './reply.js';
import { __test__ as utilsTest } from './utils.js';
import { createPageMock } from '../test-utils.js';

describe('twitter reply command', () => {
    it('uses the dedicated reply composer for text-only replies too', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true },
            { ok: true },
            { ok: true, message: 'Reply posted successfully.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'text-only reply',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post?in_reply_to=2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenCalledWith({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'text-only reply',
            },
        ]);
    });
    it('typed-fails when the reply never leaves the composer', async () => {
        const cmd = getRegistry().get('twitter/reply');
        const page = createPageMock([
            { ok: true },
            { ok: true },
            { ok: false, message: 'Reply button is disabled or not found.' },
        ]);

        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161',
            text: 'never sent',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Reply button is disabled or not found.',
            hint: expect.stringContaining('Nothing was posted'),
        });
    });

    it('reports an unconfirmed reply as temporary, without claiming nothing was posted', async () => {
        const cmd = getRegistry().get('twitter/reply');
        const page = createPageMock([
            { ok: true },
            { ok: true },
            { ok: false, unconfirmed: true, message: 'Reply submission did not complete before timeout.' },
        ]);

        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161',
            text: 'unconfirmed',
        })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('may already be live'),
        });
    });

    it('uploads a local image through the dedicated reply composer when --image is provided', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-reply-'));
        const imagePath = path.join(tempDir, 'qr.png');
        fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true, previewCount: 1 },
            { ok: true },
            { ok: true },
            { ok: true, message: 'Reply posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'reply with image',
            image: imagePath,
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post?in_reply_to=2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(page.wait).toHaveBeenNthCalledWith(2, { selector: 'input[type="file"][data-testid="fileInput"]', timeout: 20 });
        expect(setFileInput).toHaveBeenCalledWith([imagePath], 'input[type="file"][data-testid="fileInput"]');
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'reply with image',
                image: imagePath,
            },
        ]);
    });
    it('downloads a remote image before uploading when --image-url is provided', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('image/png'),
            },
            arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer),
        });
        vi.stubGlobal('fetch', fetchMock);
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true, previewCount: 1 },
            { ok: true },
            { ok: true },
            { ok: true, message: 'Reply posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'reply with remote image',
            'image-url': 'https://example.com/qr',
        });
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/qr');
        expect(setFileInput).toHaveBeenCalledTimes(1);
        const uploadedPath = setFileInput.mock.calls[0][0][0];
        // Tmp dir is created by utils.downloadRemoteImage with the
        // 'opencli-twitter-' prefix; final extension comes from Content-Type.
        expect(uploadedPath).toMatch(/opencli-twitter-.*\/image\.png$/);
        // Per-call tmp dir is removed in the adapter's finally block, so the
        // downloaded file no longer exists once the command returns.
        expect(fs.existsSync(uploadedPath)).toBe(false);
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'reply with remote image',
                'image-url': 'https://example.com/qr',
            },
        ]);
        vi.unstubAllGlobals();
    });
    it('falls back to the target tweet page when the dedicated composer route does not expose a textarea', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const wait = vi.fn()
            .mockRejectedValueOnce(new Error('Selector not found: [data-testid="tweetTextarea_0"]'))
            .mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true }, // insert reply text
            { ok: true }, // click composer Reply button
            { ok: true, message: 'Reply posted successfully.' }, // submit completed
        ], { wait, evaluateOnce: vi.fn().mockResolvedValue({ ok: true }) });

        const url = 'https://x.com/_kop6/status/2040254679301718161?s=20';
        const result = await cmd.func(page, { url, text: 'fallback reply' });

        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/compose/post?in_reply_to=2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://x.com/i/status/2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenLastCalledWith({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(result).toEqual([{ status: 'success', message: 'Reply posted successfully.', text: 'fallback reply' }]);
    });
    it('treats an X success toast as success after a Promise was collected error', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce({ ok: true }) // insert reply text
            .mockResolvedValueOnce({ ok: true }) // click Reply
            .mockRejectedValueOnce(new Error('{"code":-32000,"message":"Promise was collected"}'))
            .mockResolvedValueOnce({
                ok: true,
                message: 'Reply posted successfully.',
                url: 'https://x.com/me/status/123',
            });
        const page = createPageMock([], { evaluate });

        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'toast recovery',
        });

        expect(page.wait).toHaveBeenCalledWith(2);
        expect(result).toEqual([{
            status: 'success',
            message: 'Reply posted successfully.',
            text: 'toast recovery',
            url: 'https://x.com/me/status/123',
        }]);
    });

    // Run the click + completion polling scripts against a DOM so current
    // submit evidence is tested instead of just trusting mocked evaluate rows.
    const runReplyAgainstDom = async (html, text, { afterClickHtml = '' } = {}) => {
        const cmd = getRegistry().get('twitter/reply');
        const dom = new JSDOM(`<!doctype html><body><button data-testid="tweetButton">Reply</button>${html}</body>`, {
            url: 'https://x.com/compose/post?in_reply_to=2040254679301718161',
            runScripts: 'outside-only',
        });
        dom.window.setTimeout = (callback) => {
            callback();
            return 0;
        };
        dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
        let evaluateCount = 0;
        const page = createPageMock([], {
            evaluate: vi.fn((script) => {
                evaluateCount += 1;
                if (evaluateCount === 1) return Promise.resolve({ ok: true });
                if (evaluateCount === 2) {
                    const result = dom.window.eval(script);
                    if (afterClickHtml) {
                        dom.window.document.body.insertAdjacentHTML('beforeend', afterClickHtml);
                    }
                    return Promise.resolve(result);
                }
                return Promise.resolve(dom.window.eval(script));
            }),
        });

        return cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text,
        });
    };

    it('does not report reply success from a cleared composer without a fresh toast', async () => {
        await expect(runReplyAgainstDom('', 'cleared reply')).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('Reply submission did not complete before timeout.'),
        });
    });

    it('ignores a reply success toast that existed before clicking Reply', async () => {
        const oldToast = `
            <div role="alert">Your post was sent. <a href="/me/status/3333333333333333333">View</a></div>
        `;

        await expect(runReplyAgainstDom(oldToast, 'old reply toast')).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('Reply submission did not complete before timeout.'),
        });
    });

    it('returns the permalink from a fresh reply success toast only', async () => {
        const timeline = '<article><a href="/nasa/status/1111111111111111111">someone else</a></article>';
        const toast = `
            <div role="alert">Your post was sent. <a href="/me/status/4444444444444444444">View</a></div>
        `;

        await expect(runReplyAgainstDom(timeline, 'fresh reply toast', { afterClickHtml: toast })).resolves.toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'fresh reply toast',
                url: 'https://x.com/me/status/4444444444444444444',
            },
        ]);
    });

    it('does not export a reply permalink from an untrusted toast link host', async () => {
        const toast = `
            <div role="alert">Your post was sent. <a href="https://example.com/me/status/5555555555555555555">View</a></div>
        `;

        await expect(runReplyAgainstDom('', 'reply bad host', { afterClickHtml: toast })).resolves.toEqual([
            { status: 'success', message: 'Reply posted successfully.', text: 'reply bad host' },
        ]);
    });

    it('unwraps Browser Bridge envelopes for reply action results', async () => {
        const cmd = getRegistry().get('twitter/reply');
        const page = createPageMock([
            { session: 'site:twitter', data: { ok: true } },
            { session: 'site:twitter', data: { ok: true } },
            {
                session: 'site:twitter',
                data: {
                    ok: true,
                    message: 'Reply posted successfully.',
                    url: 'https://x.com/me/status/6666666666666666666',
                },
            },
        ]);

        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'wrapped reply',
        })).resolves.toEqual([{
            status: 'success',
            message: 'Reply posted successfully.',
            text: 'wrapped reply',
            url: 'https://x.com/me/status/6666666666666666666',
        }]);
    });

    it('fails closed when reply completion returns a malformed status URL', async () => {
        const cmd = getRegistry().get('twitter/reply');
        const page = createPageMock([
            { ok: true },
            { ok: true },
            { ok: true, message: 'Reply posted successfully.', url: 'https://example.com/me/status/7777777777777777777' },
        ]);

        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'bad reply url',
        })).rejects.toThrow('malformed status url');
    });

    it('rejects using --image and --image-url together', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'nope',
            image: '/tmp/a.png',
            'image-url': 'https://example.com/a.png',
        })).rejects.toThrow(CommandExecutionError);
    });
    it('rejects malformed tweet URLs before any browser interaction', () => {
        // buildReplyComposerUrl runs parseTweetUrl synchronously; substring matches
        // and off-domain hosts now throw ArgumentError instead of silently
        // producing a wrong-host /compose/post URL.
        expect(() => __test__.buildReplyComposerUrl('https://x.com/alice/home')).toThrow(ArgumentError);
        expect(() => __test__.buildReplyComposerUrl('https://x.com.evil.com/alice/status/2040254679301718161')).toThrow(ArgumentError);
        expect(() => __test__.buildReplyComposerUrl('not a url')).toThrow(ArgumentError);
    });
    it('builds the reply composer URL for both /<user>/status/<id> and /i/status/<id> shapes', () => {
        expect(__test__.buildReplyComposerUrl('https://x.com/_kop6/status/2040254679301718161?s=20'))
            .toBe('https://x.com/compose/post?in_reply_to=2040254679301718161');
        expect(__test__.buildReplyComposerUrl('https://x.com/i/status/2040318731105313143'))
            .toBe('https://x.com/compose/post?in_reply_to=2040318731105313143');
    });
});

describe('twitter reply fallback DOM', () => {
    const targetId = '2040254679301718161';
    const targetUrl = `https://x.com/target/status/${targetId}`;
    const tweet = (id, extra = '', action = '') => `<article data-testid="tweet">
        <a href="/author/status/${id}"><time>timestamp</time></a>
        ${extra}${action || `<button data-testid="reply" data-open-id="${id}">Reply</button>`}
    </article>`;

    // Execute the exact opening, typing, submit and confirmation scripts through
    // command entry. Only the browser bridge and the failed direct route are fake.
    async function runFallback(html, { onTick, location, loseOpeningResponse = false, url = targetUrl } = {}) {
        const dom = new JSDOM('<!doctype html><body></body>', {
            url: 'https://x.com/home', runScripts: 'outside-only',
        });
        let elapsed = 0;
        let submits = 0;
        const openings = [];
        const openedAt = [];
        dom.window.HTMLElement.prototype.getClientRects = function () {
            for (let el = this; el; el = el.parentElement) {
                if (el.hidden || el.getAttribute('aria-hidden') === 'true'
                    || el.style.display === 'none' || el.style.visibility === 'hidden') return [];
            }
            return [{ width: 10, height: 10 }];
        };
        dom.window.setTimeout = (callback, ms) => {
            elapsed += Number(ms) || 0;
            onTick?.(elapsed, dom.window.document);
            queueMicrotask(callback);
            return 0;
        };
        dom.window.document.execCommand = (_command, _ui, text) => {
            dom.window.document.activeElement.innerText = text;
            return true;
        };
        dom.window.document.addEventListener('click', event => {
            const opening = event.target.closest('[data-testid="reply"]');
            if (opening) {
                openings.push(opening.getAttribute('data-open-id'));
                openedAt.push(elapsed);
                dom.window.document.body.insertAdjacentHTML('beforeend', `<div role="dialog">
                    <div data-testid="tweetTextarea_0" contenteditable="true" tabindex="0"></div>
                    <button data-testid="tweetButton">Submit reply</button></div>`);
            }
            if (event.target.closest('[data-testid="tweetButton"]')) {
                submits += 1;
                dom.window.document.body.insertAdjacentHTML('beforeend',
                    '<div role="alert">Your post was sent <a href="/me/status/999">View</a></div>');
            }
        });
        let navigation = 0;
        let waited = false;
        const page = createPageMock([], {
            goto: vi.fn(async destination => {
                navigation += 1;
                dom.reconfigure({ url: navigation === 1 ? 'https://x.com/home' : location || destination });
                dom.window.document.body.innerHTML = navigation === 1
                    ? '<div role="dialog"><div role="progressbar"></div></div>' : html;
            }),
            wait: vi.fn(async () => {
                if (!waited) {
                    waited = true;
                    throw new Error('Selector not found: [data-testid="tweetTextarea_0"]');
                }
                expect(dom.window.document.querySelector('[data-testid="tweetTextarea_0"]')).not.toBeNull();
            }),
            evaluateOnce: vi.fn(async script => {
                const result = await dom.window.eval(script);
                if (loseOpeningResponse) throw new Error('Cannot find default execution context');
                return result;
            }),
            evaluate: vi.fn(async script => dom.window.eval(script)),
        });
        try {
            const result = await getRegistry().get('twitter/reply').func(page, { url, text: 'fixture reply' })
                .then(value => ({ value }), error => ({ error }));
            return { ...result, page, openings, openedAt, submits, elapsed };
        } finally {
            dom.window.close();
        }
    }

    it('waits for the target article while ignoring the first background Reply action', async () => {
        let added = false;
        const result = await runFallback(tweet('111'), {
            onTick: (ms, document) => {
                if (ms >= 750 && !added) {
                    added = true;
                    document.body.insertAdjacentHTML('beforeend', tweet(targetId));
                }
            },
        });
        expect(result.error).toBeUndefined();
        expect(result.openings).toEqual([targetId]);
        expect(result.openedAt).toEqual([750]);
        expect(result.submits).toBe(1);
        expect(result.page.evaluateOnce).toHaveBeenCalledTimes(1);
    });

    it('waits for the target action to become enabled', async () => {
        const html = tweet(targetId, '', `<button data-testid="reply" data-open-id="${targetId}" disabled>Reply</button>`);
        const result = await runFallback(html, {
            onTick: (ms, document) => { if (ms >= 500) document.querySelector('[data-testid="reply"]').disabled = false; },
        });
        expect(result.openings).toEqual([targetId]);
        expect(result.openedAt).toEqual([500]);
        expect(result.submits).toBe(1);
    });

    it('waits for a delayed Reply button on an already rendered target article', async () => {
        let added = false;
        const result = await runFallback(tweet(targetId, '', '<div>Actions loading</div>'), {
            onTick: (ms, document) => {
                if (ms >= 1000 && !added) {
                    added = true;
                    document.querySelector('article').insertAdjacentHTML('beforeend',
                        `<button data-testid="reply" data-open-id="${targetId}">Reply</button>`);
                }
            },
        });
        expect(result.openings).toEqual([targetId]);
        expect(result.openedAt).toEqual([1000]);
        expect(result.submits).toBe(1);
    });

    it('ignores quoted Reply actions even when they precede the target action', async () => {
        const quote = `<div role="link" tabindex="0"><a href="/quoted/status/222"><time>quoted</time></a>
            <button data-testid="reply" data-open-id="222">Reply to quote</button></div>`;
        const result = await runFallback(tweet(targetId, quote));
        expect(result.openings).toEqual([targetId]);
        expect(result.submits).toBe(1);
    });

    it.each([
        ['missing target', tweet('111')],
        ['quoted target without a nested article', tweet('111', `<div role="link" tabindex="0"><a href="/target/status/${targetId}"><time>quote</time></a></div>`)],
        ['nested quoted article', tweet('111', `<div data-testid="quoteTweet">${tweet(targetId)}</div>`)],
        ['hidden ancestor', `<div hidden>${tweet(targetId)}</div>`],
        ['aria-hidden ancestor', `<div aria-hidden="true">${tweet(targetId)}</div>`],
        ['CSS-hidden ancestor', `<div style="display:none">${tweet(targetId)}</div>`],
        ['duplicate target articles', tweet(targetId) + tweet(targetId)],
        ['two own timestamps', tweet(targetId, '<a href="/other/status/333"><time>other</time></a>')],
        ['duplicate actions, only one enabled', tweet(targetId, '', `<button data-testid="reply" disabled>Disabled</button><button data-testid="reply" data-open-id="${targetId}">Reply</button>`)],
        ['unexpected dialog', tweet(targetId) + '<div role="dialog">Another composer</div>'],
    ])('refuses %s without typing or submitting', async (_name, html) => {
        const result = await runFallback(html);
        expect(result.error).toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('unique ready Reply action') });
        expect(result.openings).toEqual([]);
        expect(result.submits).toBe(0);
        expect(result.page.evaluate).not.toHaveBeenCalled();
        expect(result.elapsed).toBe(15_000);
        expect(result.page.evaluateOnce).toHaveBeenCalledTimes(1);
    });

    it.each(['https://x.com/home', 'https://x.com/other/status/111', `https://example.com/target/status/${targetId}`])(
        'refuses a redirected page at %s despite a matching background article', async location => {
            const result = await runFallback(tweet(targetId), { location });
            expect(result.error).toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('page changed') });
            expect(result.openings).toEqual([]);
            expect(result.submits).toBe(0);
            expect(result.page.evaluate).not.toHaveBeenCalled();
        }
    );

    it('canonicalizes an accepted alias and removes query/hash before fallback navigation', async () => {
        const result = await runFallback(tweet(targetId), { url: `https://mobile.twitter.com/target/status/${targetId}?s=20#fragment` });
        expect(result.page.goto).toHaveBeenLastCalledWith(`https://x.com/i/status/${targetId}`, { waitUntil: 'load', settleMs: 2500 });
        expect(result.openings).toEqual([targetId]);
    });

    it('does not replay opening or continue typing/upload/submission after a lost opening response', async () => {
        const result = await runFallback(tweet(targetId), { loseOpeningResponse: true });
        expect(result.error?.message).toBe('Cannot find default execution context');
        expect(result.openings).toEqual([targetId]);
        expect(result.page.evaluateOnce).toHaveBeenCalledTimes(1);
        expect(result.page.evaluate).not.toHaveBeenCalled();
        expect(result.page.setFileInput).not.toHaveBeenCalled();
        expect(result.submits).toBe(0);
    });
});

describe('twitter image helpers (utils.js)', () => {
    it('rejects invalid image paths early', () => {
        expect(() => utilsTest.resolveImagePath('/tmp/does-not-exist.png'))
            .toThrow(ArgumentError);
    });
    it('prefers content-type when resolving remote image extensions', () => {
        expect(utilsTest.resolveImageExtension('https://example.com/no-ext', 'image/webp')).toBe('.webp');
        expect(utilsTest.resolveImageExtension('https://example.com/a.jpeg?x=1', null)).toBe('.jpeg');
    });

    it('classifies CDP NotAllowed file-input failures as recoverable', () => {
        expect(utilsTest.isRecoverableFileInputError(new Error('NotAllowedError: Not allowed'))).toBe(true);
        expect(utilsTest.isRecoverableFileInputError(new Error('ProtocolError: not-allowed'))).toBe(true);
        expect(utilsTest.isRecoverableFileInputError(new Error('Permission denied'))).toBe(false);
    });

    it('fails closed when a composer image preview never appears', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-helper-'));
        const imagePath = path.join(tempDir, 'missing-preview.png');
        fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const page = createPageMock([{ ok: false, message: 'Image upload timed out (30s).' }], {
            setFileInput: vi.fn().mockResolvedValue(undefined),
        });

        await expect(utilsTest.attachComposerImage(page, imagePath)).rejects.toThrow('Image upload timed out');
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('does not treat an empty attachments container as uploaded media', async () => {
        const runMediaReadyProbe = async (html) => {
            const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
                url: 'https://x.com/compose/post',
                runScripts: 'outside-only',
            });
            dom.window.setTimeout = (callback) => {
                callback();
                return 0;
            };
            const page = {
                evaluate: vi.fn(async (script) => dom.window.eval(script)),
            };
            return utilsTest.waitForComposerMediaReady(page, 1);
        };

        await expect(runMediaReadyProbe('<div data-testid="attachments"></div>'))
            .resolves.toMatchObject({ ok: false });
        await expect(runMediaReadyProbe('<div data-testid="attachments"><img src="blob:https://x.com/1"></div>'))
            .resolves.toMatchObject({ ok: true, previewCount: 1 });
    });
});
