import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import * as privatePublish from './_shared/private-publish.js';
import { buildClickActionJs, buildEnsureComposerOpenJs, buildInspectUploadStageJs, buildPublishStatusProbeJs } from './post.js';
import './post.js';
const tempDirs = [];
function createTempImage(name = 'demo.jpg', bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-instagram-post-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}
function createTempVideo(name = 'demo.mp4', bytes = Buffer.from('video')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-instagram-post-video-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}
function withInitialDialogDismiss(results) {
    return [{ ok: false }, ...results];
}
function createPageMock(evaluateResults, overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        closeTab: vi.fn().mockResolvedValue(undefined),
        newTab: vi.fn().mockResolvedValue(undefined),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        insertText: undefined,
        getCurrentUrl: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}
afterAll(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.OPENCLI_INSTAGRAM_CAPTURE;
});
describe('instagram auth detection', () => {
    it('does not treat generic homepage text containing "log in" as an auth failure', () => {
        const globalState = globalThis;
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        globalState.document = {
            body: { innerText: 'Suggested for you Log in to see more content' },
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        globalState.window = { location: { pathname: '/' } };
        try {
            expect(eval(buildEnsureComposerOpenJs())).toEqual({ ok: true });
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
        }
    });
});
describe('instagram publish status detection', () => {
    it('does not treat unrelated page text as share failure while the sharing dialog is still visible', () => {
        const globalState = globalThis;
        class MockHTMLElement {
        }
        const visibleDialog = new MockHTMLElement();
        visibleDialog.textContent = 'Sharing';
        visibleDialog.querySelector = () => null;
        visibleDialog.getBoundingClientRect = () => ({ width: 100, height: 100 });
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            querySelectorAll: (selector) => selector === '[role="dialog"]' ? [visibleDialog] : [],
        };
        globalState.window = {
            location: { href: 'https://www.instagram.com/' },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildPublishStatusProbeJs())).toEqual({
                ok: false,
                failed: false,
                settled: false,
                url: '',
            });
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
    it('does not treat a stale visible error dialog as share failure while sharing is still in progress', () => {
        const globalState = globalThis;
        class MockHTMLElement {
        }
        const sharingDialog = new MockHTMLElement();
        sharingDialog.textContent = 'Sharing';
        sharingDialog.querySelector = () => null;
        sharingDialog.getBoundingClientRect = () => ({ width: 100, height: 100 });
        const staleErrorDialog = new MockHTMLElement();
        staleErrorDialog.textContent = 'Something went wrong. Please try again. Try again';
        staleErrorDialog.querySelector = () => null;
        staleErrorDialog.getBoundingClientRect = () => ({ width: 100, height: 100 });
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            querySelectorAll: (selector) => selector === '[role="dialog"]' ? [sharingDialog, staleErrorDialog] : [],
        };
        globalState.window = {
            location: { href: 'https://www.instagram.com/' },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildPublishStatusProbeJs())).toEqual({
                ok: false,
                failed: false,
                settled: false,
                url: '',
            });
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
    it('prefers explicit post-shared success over stale visible error text', () => {
        const globalState = globalThis;
        class MockHTMLElement {
        }
        const sharedDialog = new MockHTMLElement();
        sharedDialog.textContent = 'Post shared Your post has been shared.';
        sharedDialog.querySelector = () => null;
        sharedDialog.getBoundingClientRect = () => ({ width: 100, height: 100 });
        const staleErrorDialog = new MockHTMLElement();
        staleErrorDialog.textContent = 'Something went wrong. Please try again. Try again';
        staleErrorDialog.querySelector = () => null;
        staleErrorDialog.getBoundingClientRect = () => ({ width: 100, height: 100 });
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            querySelectorAll: (selector) => selector === '[role="dialog"]' ? [sharedDialog, staleErrorDialog] : [],
        };
        globalState.window = {
            location: { href: 'https://www.instagram.com/' },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildPublishStatusProbeJs())).toEqual({
                ok: true,
                failed: false,
                settled: false,
                url: '',
            });
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
});
describe('instagram click action detection', () => {
    it('matches aria-label-only Next buttons in the media dialog', () => {
        const globalState = globalThis;
        class MockHTMLElement {
            textContent = '';
            ariaLabel = '';
            clicked = false;
            querySelectorAll = (_selector) => [];
            querySelector = (_selector) => null;
            getAttribute(name) {
                if (name === 'aria-label')
                    return this.ariaLabel || null;
                return null;
            }
            getBoundingClientRect() {
                return { width: 100, height: 40 };
            }
            click() {
                this.clicked = true;
            }
        }
        const nextButton = new MockHTMLElement();
        nextButton.ariaLabel = 'Next';
        const dialog = new MockHTMLElement();
        dialog.textContent = 'Crop Back Select crop Open media gallery';
        dialog.querySelector = (selector) => selector === 'input[type="file"]' ? {} : null;
        dialog.querySelectorAll = (selector) => selector === 'button, div[role="button"]' ? [nextButton] : [];
        const body = new MockHTMLElement();
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            body,
            querySelectorAll: (selector) => selector === '[role="dialog"]' ? [dialog] : [],
        };
        globalState.window = {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildClickActionJs(['Next', '下一步'], 'media'))).toEqual({
                ok: true,
                label: 'Next',
            });
            expect(nextButton.clicked).toBe(true);
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
    it('does not click a body-level Next button when media scope has no matching dialog controls', () => {
        const globalState = globalThis;
        class MockHTMLElement {
            textContent = '';
            ariaLabel = '';
            clicked = false;
            children = [];
            querySelectorAll = (_selector) => this.children;
            querySelector = (_selector) => null;
            getAttribute(name) {
                if (name === 'aria-label')
                    return this.ariaLabel || null;
                return null;
            }
            getBoundingClientRect() {
                return { width: 100, height: 40 };
            }
            click() {
                this.clicked = true;
            }
        }
        const bodyNext = new MockHTMLElement();
        bodyNext.ariaLabel = 'Next';
        const errorDialog = new MockHTMLElement();
        errorDialog.textContent = 'Something went wrong Try again';
        errorDialog.children = [];
        const body = new MockHTMLElement();
        body.children = [bodyNext];
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            body,
            querySelectorAll: (selector) => selector === '[role="dialog"]' ? [errorDialog] : [],
        };
        globalState.window = {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildClickActionJs(['Next', '下一步'], 'media'))).toEqual({ ok: false });
            expect(bodyNext.clicked).toBe(false);
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
});
describe('instagram upload stage detection', () => {
    it('does not treat a body-level Next button as upload preview when the visible dialog is an error', () => {
        const globalState = globalThis;
        class MockHTMLElement {
            textContent = '';
            ariaLabel = '';
            children = [];
            querySelectorAll = (_selector) => this.children;
            querySelector = (_selector) => null;
            getAttribute(name) {
                if (name === 'aria-label')
                    return this.ariaLabel || null;
                return null;
            }
            getBoundingClientRect() {
                return { width: 100, height: 40 };
            }
        }
        const bodyNext = new MockHTMLElement();
        bodyNext.ariaLabel = 'Next';
        const errorDialog = new MockHTMLElement();
        errorDialog.textContent = 'Something went wrong. Please try again. Try again';
        const body = new MockHTMLElement();
        body.children = [bodyNext];
        const originalDocument = globalState.document;
        const originalWindow = globalState.window;
        const originalHTMLElement = globalState.HTMLElement;
        globalState.HTMLElement = MockHTMLElement;
        globalState.document = {
            body,
            querySelectorAll: (selector) => {
                if (selector === '[role="dialog"]')
                    return [errorDialog];
                return [];
            },
        };
        globalState.window = {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        };
        try {
            expect(eval(buildInspectUploadStageJs())).toEqual({
                state: 'failed',
                detail: 'Something went wrong. Please try again. Try again',
            });
        }
        finally {
            globalState.document = originalDocument;
            globalState.window = originalWindow;
            globalState.HTMLElement = originalHTMLElement;
        }
    });
});
describe('instagram post registration', () => {
    beforeEach(() => {
        vi.spyOn(privatePublish, 'resolveInstagramPrivatePublishConfig').mockResolvedValue({
            apiContext: {
                asbdId: '',
                csrfToken: 'csrf-token',
                igAppId: '936619743392459',
                igWwwClaim: '',
                instagramAjax: '1036523242',
                webSessionId: '',
            },
            jazoest: '22047',
        });
        vi.spyOn(privatePublish, 'publishImagesViaPrivateApi').mockRejectedValue(new CommandExecutionError('Instagram private publish configure failed: 400 {"message":"fallback to ui"}'));
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('registers the post command with a required-value media arg', () => {
        const cmd = getRegistry().get('instagram/post');
        expect(cmd).toBeDefined();
        expect(cmd?.browser).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'timeout' && arg.default === 300)).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'media' && !arg.required && arg.valueRequired)).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'content' && !arg.required && arg.positional)).toBe(true);
    });
    it('prefers the private route by default and returns without touching UI upload steps when private publish succeeds', async () => {
        const imagePath = createTempImage('private-default.jpg');
        const privateSpy = vi.spyOn(privatePublish, 'publishImagesViaPrivateApi').mockResolvedValueOnce({
            code: 'PRIVATEDEFAULT123',
            uploadIds: ['111'],
        });
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('const data = Array.isArray(window[') && js.includes('__opencli_ig_protocol_capture'))
                return { data: [], errors: [] };
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            getCookies: vi.fn().mockResolvedValue([{ name: 'csrftoken', value: 'csrf-token', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, { media: imagePath, content: 'private default' });
        expect(privateSpy).toHaveBeenCalledTimes(1);
        expect(page.setFileInput).not.toHaveBeenCalled();
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/PRIVATEDEFAULT123/',
            },
        ]);
        privateSpy.mockRestore();
    });
    it('falls back to the UI route when the default private route fails safely before publishing', async () => {
        const imagePath = createTempImage('private-fallback-ui.jpg');
        const privateSpy = vi.spyOn(privatePublish, 'publishImagesViaPrivateApi').mockRejectedValueOnce(new CommandExecutionError('Instagram private publish configure_sidecar failed: 400 {"message":"Uploaded image is invalid"}'));
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/PRIVATEFALLBACK123/' };
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            getCookies: vi.fn().mockResolvedValue([{ name: 'csrftoken', value: 'csrf-token', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, { media: imagePath, content: 'private fallback' });
        expect(privateSpy).toHaveBeenCalledTimes(1);
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath], '[data-opencli-ig-upload-index="0"]');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/PRIVATEFALLBACK123/',
            },
        ]);
        privateSpy.mockRestore();
    });
    it('falls back to the UI route for mixed-media posts when the private route fails safely before publishing', async () => {
        const imagePath = createTempImage('mixed-fallback-image.jpg');
        const videoPath = createTempVideo('mixed-fallback-video.mp4');
        const privateSpy = vi.spyOn(privatePublish, 'publishMediaViaPrivateApi').mockRejectedValueOnce(new CommandExecutionError('Instagram private publish configure_sidecar failed: 400 {"message":"fallback to ui"}'));
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/MIXEDFALLBACK123/' };
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            getCookies: vi.fn().mockResolvedValue([{ name: 'csrftoken', value: 'csrf-token', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: `${imagePath},${videoPath}`,
            content: 'mixed ui fallback',
        });
        expect(privateSpy).toHaveBeenCalledTimes(1);
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath, videoPath], '[data-opencli-ig-upload-index="0"]');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '2-item mixed-media carousel post shared successfully',
                url: 'https://www.instagram.com/p/MIXEDFALLBACK123/',
            },
        ]);
        privateSpy.mockRestore();
    });
    it('prefers the private route by default for mixed-media posts and preserves input order', async () => {
        const imagePath = createTempImage('mixed-default.jpg');
        const videoPath = createTempVideo('mixed-default.mp4');
        const privateSpy = vi.spyOn(privatePublish, 'publishMediaViaPrivateApi').mockResolvedValueOnce({
            code: 'MIXEDPRIVATE123',
            uploadIds: ['111', '222'],
        });
        const page = createPageMock([], {
            evaluate: vi.fn(async () => ({ ok: true })),
            getCookies: vi.fn().mockResolvedValue([{ name: 'csrftoken', value: 'csrf-token', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: `${imagePath},${videoPath}`,
            content: 'mixed private default',
        });
        expect(privateSpy).toHaveBeenCalledWith(expect.objectContaining({
            mediaItems: [
                { type: 'image', filePath: imagePath },
                { type: 'video', filePath: videoPath },
            ],
            caption: 'mixed private default',
        }));
        expect(page.setFileInput).not.toHaveBeenCalled();
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '2-item mixed-media carousel post shared successfully',
                url: 'https://www.instagram.com/p/MIXEDPRIVATE123/',
            },
        ]);
        privateSpy.mockRestore();
    });
    it('rejects missing --media before browser work', async () => {
        const page = createPageMock([]);
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            content: 'missing media',
        })).rejects.toThrow('Argument "media" is required.');
    });
    it('rejects empty or invalid --media inputs', async () => {
        const imagePath = createTempImage('invalid-media-image.jpg');
        const page = createPageMock([]);
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: '',
        })).rejects.toThrow('Argument "media" is required.');
        await expect(cmd.func(page, {
            media: `${imagePath},/tmp/does-not-exist.mp4`,
        })).rejects.toThrow('Media file not found');
    });
    it('uploads a single image, fills caption, and shares the post', async () => {
        const imagePath = createTempImage();
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/ABC123xyz/' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'hello from opencli',
        });
        expect(page.goto).toHaveBeenCalledWith('https://www.instagram.com/');
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath], '[data-opencli-ig-upload-index="0"]');
        expect(page.evaluate.mock.calls.some((args) => String(args[0]).includes("dispatchEvent(new Event('change'"))).toBe(true);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/ABC123xyz/',
            },
        ]);
    });
    it('uploads multiple images as a carousel and shares the post', async () => {
        const firstImagePath = createTempImage('carousel-1.jpg');
        const secondImagePath = createTempImage('carousel-2.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/CAROUSEL123/' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: `${firstImagePath},${secondImagePath}`,
            content: 'hello carousel',
        });
        expect(page.setFileInput).toHaveBeenCalledWith([firstImagePath, secondImagePath], '[data-opencli-ig-upload-index="0"]');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '2-image carousel post shared successfully',
                url: 'https://www.instagram.com/p/CAROUSEL123/',
            },
        ]);
    });
    it('installs and dumps protocol capture when OPENCLI_INSTAGRAM_CAPTURE is enabled', async () => {
        process.env.OPENCLI_INSTAGRAM_CAPTURE = '1';
        const imagePath = createTempImage('capture-enabled.jpg');
        const evaluate = vi.fn(async (js) => {
            if (js.includes('__opencli_ig_protocol_capture') && js.includes('PATCH_GUARD'))
                return { ok: true };
            if (js.includes('const data = Array.isArray(window[') && js.includes('__opencli_ig_protocol_capture')) {
                return { data: [], errors: [] };
            }
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/CAPTURE123/' };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'capture enabled',
        });
        const evaluateCalls = evaluate.mock.calls.map((args) => String(args[0]));
        expect(evaluateCalls.some((js) => js.includes('__opencli_ig_protocol_capture') && js.includes('PATCH_GUARD'))).toBe(true);
        expect(evaluateCalls.some((js) => js.includes('const data = Array.isArray(window[') && js.includes('__opencli_ig_protocol_capture'))).toBe(true);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/CAPTURE123/',
            },
        ]);
        delete process.env.OPENCLI_INSTAGRAM_CAPTURE;
    });
    it('retries media Next when preview is visible before the button becomes clickable', async () => {
        const firstImagePath = createTempImage('carousel-delay-1.jpg');
        const secondImagePath = createTempImage('carousel-delay-2.jpg');
        let nextAttempts = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs'))
                return { state: 'preview', detail: 'Crop Back Next Select crop' };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: nextAttempts >= 2 };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                nextAttempts += 1;
                if (nextAttempts === 1)
                    return { ok: false };
                return { ok: true, label: 'Next' };
            }
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/CAROUSELRETRY123/' };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: `${firstImagePath},${secondImagePath}`,
            content: 'hello delayed carousel',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '2-image carousel post shared successfully',
                url: 'https://www.instagram.com/p/CAROUSELRETRY123/',
            },
        ]);
    });
    it('retries the whole carousel flow when preview briefly appears and then degrades into an upload error before Next is usable', async () => {
        const firstImagePath = createTempImage('carousel-race-1.jpg');
        const secondImagePath = createTempImage('carousel-race-2.jpg');
        let composerRuns = 0;
        let uploadStageChecks = 0;
        let secondAttemptAdvanced = false;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname')) {
                composerRuns += 1;
                return { ok: true };
            }
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs')) {
                uploadStageChecks += 1;
                if (composerRuns === 1 && uploadStageChecks === 1) {
                    return { state: 'preview', detail: 'Crop Back Next Select crop' };
                }
                if (composerRuns === 1) {
                    return { state: 'failed', detail: 'Something went wrong. Please try again.' };
                }
                return { state: 'preview', detail: 'Crop Back Next Select crop' };
            }
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: composerRuns >= 2 && secondAttemptAdvanced };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                if (composerRuns === 1)
                    return { ok: false };
                secondAttemptAdvanced = true;
                return { ok: true, label: 'Next' };
            }
            if (js.includes('button[aria-label="Close"]'))
                return { ok: true };
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/CAROUSELFRESH123/' };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: `${firstImagePath},${secondImagePath}`,
            content: 'hello recovered carousel',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '2-image carousel post shared successfully',
                url: 'https://www.instagram.com/p/CAROUSELFRESH123/',
            },
        ]);
    });
    it('uploads a single image and shares it without a caption when content is omitted', async () => {
        const imagePath = createTempImage('no-caption.jpg');
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('const editable = document.querySelector(\'textarea, [contenteditable="true"]\');'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/NOCAPTION123/' };
            return { ok: false };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
        });
        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        expect(evaluateCalls.some((js) => js.includes('Write a caption'))).toBe(false);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/NOCAPTION123/',
            },
        ]);
    });
    it('falls back to browser-side file injection when the extension does not support set-file-input', async () => {
        const imagePath = createTempImage('legacy-extension.jpg');
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes('__opencliInstagramUpload_') && js.includes('] = [];'))
                return { ok: true };
            if (js.includes('parts.push(chunk)'))
                return { ok: true, count: 1 };
            if (js.includes('File input not found for fallback injection'))
                return { ok: true, count: 1 };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes('labels.includes(text)'))
                return { ok: false };
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('couldn') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/LEGACY123/' };
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            setFileInput: vi.fn().mockRejectedValue(new Error('Unknown action: set-file-input')),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'legacy bridge fallback',
        });
        expect(page.setFileInput).toHaveBeenCalledWith([imagePath], '[data-opencli-ig-upload-index="0"]');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/LEGACY123/',
            },
        ]);
    });
    it('chunks large legacy fallback uploads instead of embedding the whole image in one evaluate payload', async () => {
        const imagePath = createTempImage('legacy-large.jpg', Buffer.alloc(900 * 1024, 1));
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes('window[') && js.includes('] = [];'))
                return { ok: true };
            if (js.includes('parts.push(chunk)'))
                return { ok: true, count: 1 };
            if (js.includes('File input not found for fallback injection'))
                return { ok: true, count: 1 };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes('labels.includes(text)'))
                return { ok: false };
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('couldn') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/LARGELEGACY123/' };
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            setFileInput: vi.fn().mockRejectedValue(new Error('Unknown action: set-file-input')),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'legacy large bridge fallback',
        });
        const chunkCalls = evaluate.mock.calls.filter((args) => String(args[0]).includes('parts.push(chunk)'));
        expect(chunkCalls.length).toBeGreaterThan(1);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/LARGELEGACY123/',
            },
        ]);
    });
    it('fails clearly when Browser Bridge file upload support is unavailable', async () => {
        const imagePath = createTempImage('missing-bridge.jpg');
        const page = createPageMock([], { setFileInput: undefined });
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'hello from opencli',
        })).rejects.toThrow(CommandExecutionError);
    });
    it('maps login-gated composer access to AuthRequiredError', async () => {
        const imagePath = createTempImage('auth.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: false, reason: 'auth' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'login required',
        })).rejects.toThrow(AuthRequiredError);
    });
    it('captures a debug screenshot when the upload preview never appears', async () => {
        const imagePath = createTempImage('no-preview.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
        ]));
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'preview missing',
        })).rejects.toThrow('Instagram image preview did not appear after upload');
        expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/instagram_post_preview_debug.png' });
    });
    it('fails clearly when Instagram shows an upload-stage error dialog', async () => {
        const imagePath = createTempImage('upload-error.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: false, state: 'failed', detail: 'Something went wrong. Please try again.' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'upload should fail clearly',
        })).rejects.toThrow('Instagram image upload failed');
    });
    it('treats crop/next preview UI as success even if stale error text is still visible', async () => {
        const imagePath = createTempImage('upload-preview-wins.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            {
                ok: false,
                state: 'preview',
                detail: 'Something went wrong. Please try again. Crop Back Next Select crop Select zoom Open media gallery',
            },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/PREVIEWWINS123/' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'preview state wins over stale error text',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/PREVIEWWINS123/',
            },
        ]);
    });
    it('retries the same upload selector once after an upload-stage error and can still succeed', async () => {
        const imagePath = createTempImage('upload-retry.jpg');
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        let uploadProbeCount = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const failed =') && js.includes('const hasCaption =')) {
                uploadProbeCount += 1;
                return uploadProbeCount === 1
                    ? { ok: false, state: 'failed', detail: 'Something went wrong. Please try again.' }
                    : { ok: true, state: 'preview' };
            }
            if (js.includes('button[aria-label="Close"]'))
                return { ok: true };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/UPLOADRETRY123/' };
            return { ok: true };
        });
        const page = createPageMock([], { setFileInput, evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'upload retry succeeds',
        });
        expect(setFileInput).toHaveBeenCalledTimes(1);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/UPLOADRETRY123/',
            },
        ]);
    });
    it('clicks upload Try again in-place before resetting the whole flow when Instagram shows an upload error dialog', async () => {
        const imagePath = createTempImage('upload-inline-retry.jpg');
        let uploadProbeCount = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs')) {
                uploadProbeCount += 1;
                return uploadProbeCount === 1
                    ? { state: 'failed', detail: 'Something went wrong. Please try again.' }
                    : { state: 'preview', detail: 'Crop Back Next Select crop' };
            }
            if (js.includes('something went wrong') && js.includes('label === \'try again\''))
                return { ok: true };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: true };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                if (js.includes('"Share"'))
                    return { ok: true, label: 'Share' };
                return { ok: true, label: 'Next' };
            }
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/UPLOADINLINERETRY123/' };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'upload inline retry succeeds',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/UPLOADINLINERETRY123/',
            },
        ]);
    });
    it('retries max-size carousel upload failures beyond the expanded large-carousel budget before succeeding', async () => {
        const paths = [
            createTempImage('carousel-10-1.jpg'),
            createTempImage('carousel-10-2.jpg'),
            createTempImage('carousel-10-3.jpg'),
            createTempImage('carousel-10-4.jpg'),
            createTempImage('carousel-10-5.jpg'),
            createTempImage('carousel-10-6.jpg'),
            createTempImage('carousel-10-7.jpg'),
            createTempImage('carousel-10-8.jpg'),
            createTempImage('carousel-10-9.jpg'),
            createTempImage('carousel-10-10.jpg'),
        ];
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        let uploadProbeCount = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs')) {
                uploadProbeCount += 1;
                if (uploadProbeCount <= 16) {
                    return { state: 'failed', detail: 'Something went wrong. Please try again.' };
                }
                return { state: 'preview', detail: 'Crop Back Next Select crop' };
            }
            if (js.includes('button[aria-label="Close"]'))
                return { ok: true };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: true };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                if (js.includes('"Share"'))
                    return { ok: true, label: 'Share' };
                return { ok: true, label: 'Next' };
            }
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/CAROUSEL10RETRY123/' };
            return { ok: true };
        });
        const page = createPageMock([], { setFileInput, evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: paths.join(','),
        });
        expect(setFileInput).toHaveBeenCalledTimes(5);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: '10-image carousel post shared successfully',
                url: 'https://www.instagram.com/p/CAROUSEL10RETRY123/',
            },
        ]);
    });
    it('forces a fresh home reload before retrying after an upload-stage error', async () => {
        const imagePath = createTempImage('upload-fresh-reload.jpg');
        const gotoUrls = [];
        const goto = vi.fn(async (url) => {
            gotoUrls.push(String(url));
        });
        let uploadProbeCount = 0;
        let advancedToCaption = false;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: advancedToCaption };
            }
            if (js.includes('const hasPreviewUi =')) {
                uploadProbeCount += 1;
                if (uploadProbeCount === 1) {
                    return { ok: false, state: 'failed', detail: 'Something went wrong. Please try again.' };
                }
                return gotoUrls.some((url) => url.includes('__opencli_reset='))
                    ? { ok: true, state: 'preview' }
                    : { ok: false, state: 'failed', detail: 'Something went wrong. Please try again.' };
            }
            if (js.includes('button[aria-label="Close"]'))
                return { ok: false };
            if (js.includes("scope === 'media'")) {
                advancedToCaption = true;
                return { ok: true, label: 'Next' };
            }
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/FRESHRELOAD123/' };
            return { ok: false };
        });
        const page = createPageMock([], {
            goto,
            evaluate,
            setFileInput: vi.fn().mockResolvedValue(undefined),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'fresh reload after upload failure',
        });
        expect(gotoUrls.some((url) => url.includes('__opencli_reset='))).toBe(true);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/FRESHRELOAD123/',
            },
        ]);
    });
    it('retries the share action in-place when Instagram shows a visible try-again share failure dialog', async () => {
        const imagePath = createTempImage('share-retry.jpg');
        let shareStatusChecks = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs'))
                return { state: 'preview', detail: 'Crop Back Next Select crop' };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: true };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                if (js.includes('"Share"'))
                    return { ok: true, label: 'Share' };
                return { ok: true, label: 'Next' };
            }
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared')) {
                shareStatusChecks += 1;
                return shareStatusChecks === 1
                    ? { ok: false, failed: true, settled: false, url: '' }
                    : { ok: true, failed: false, settled: false, url: 'https://www.instagram.com/p/SHARERETRY123/' };
            }
            if (js.includes('post couldn') && js.includes('try again'))
                return { ok: true };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'share retry succeeds',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/SHARERETRY123/',
            },
        ]);
    });
    it('re-resolves the upload input when the tagged selector goes stale before setFileInput runs', async () => {
        const imagePath = createTempImage('stale-selector.jpg');
        const setFileInput = vi.fn()
            .mockRejectedValueOnce(new Error('No element found matching selector: [data-opencli-ig-upload-index="0"]'))
            .mockResolvedValueOnce(undefined);
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/STALE123/' },
        ]), { setFileInput });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'stale selector recovery',
        });
        expect(setFileInput).toHaveBeenCalledTimes(2);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/STALE123/',
            },
        ]);
    });
    it('re-resolves the upload input when CDP loses the matched file-input node before setFileInput runs', async () => {
        const imagePath = createTempImage('stale-node-id.jpg');
        const setFileInput = vi.fn()
            .mockRejectedValueOnce(new Error('{"code":-32000,"message":"Could not find node with given id"}'))
            .mockResolvedValueOnce(undefined);
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/STALEID123/' },
        ]), { setFileInput });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'stale node id recovery',
        });
        expect(setFileInput).toHaveBeenCalledTimes(2);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/STALEID123/',
            },
        ]);
    });
    it('retries opening the home composer instead of navigating to the broken /create/select route', async () => {
        const imagePath = createTempImage('retry-composer.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: false },
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/FALLBACK123/' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'retry composer',
        });
        const gotoCalls = page.goto.mock.calls.map((args) => String(args[0]));
        expect(gotoCalls.every((url) => !url.includes('/create/select'))).toBe(true);
        expect(gotoCalls.some((url) => url === 'https://www.instagram.com/')).toBe(true);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/FALLBACK123/',
            },
        ]);
    });
    it('clicks Next twice when Instagram shows an intermediate preview step before the caption editor', async () => {
        const imagePath = createTempImage('double-next.jpg');
        let nextClicks = 0;
        const evaluate = vi.fn(async (js) => {
            if (js.includes('sharing') && js.includes('create new post'))
                return { ok: false };
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasVisibleButtonInDialogs'))
                return { state: 'preview', detail: 'Crop Back Next Select crop' };
            if (js.includes("dialogText.includes('write a caption')") || js.includes("const editable = document.querySelector('textarea, [contenteditable=\"true\"]');")) {
                return { ok: nextClicks >= 2 };
            }
            if (js.includes("!labels.includes(text) && !labels.includes(aria)")) {
                if (js.includes('"Share"'))
                    return { ok: true, label: 'Share' };
                nextClicks += 1;
                return { ok: true, label: 'Next' };
            }
            if (js.includes('ClipboardEvent') && js.includes('textarea'))
                return { ok: true, mode: 'textarea' };
            if (js.includes('readLexicalText'))
                return { ok: true };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: 'https://www.instagram.com/p/DOUBLE123/' };
            return { ok: true };
        });
        const page = createPageMock([], { evaluate });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'double next flow',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/DOUBLE123/',
            },
        ]);
    });
    it('tries the next upload input when the first candidate never opens the preview', async () => {
        const imagePath = createTempImage('second-input.jpg');
        const setFileInput = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined);
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]', '[data-opencli-ig-upload-index="1"]'] },
            { ok: true },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: false },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/p/SECOND123/' },
        ]), { setFileInput });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'second input works',
        });
        expect(setFileInput).toHaveBeenNthCalledWith(1, [imagePath], '[data-opencli-ig-upload-index="0"]');
        expect(setFileInput).toHaveBeenNthCalledWith(2, [imagePath], '[data-opencli-ig-upload-index="1"]');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/SECOND123/',
            },
        ]);
    });
    it('fails fast when Instagram reports that the post could not be shared', async () => {
        const imagePath = createTempImage('share-failed.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: false, failed: true, url: '' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'share should fail',
        })).rejects.toThrow('Instagram post share failed');
    });
    it('keeps waiting across the full publish timeout window instead of fast-forwarding after 30 polls', async () => {
        const imagePath = createTempImage('slow-share.jpg');
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            ...Array.from({ length: 35 }, () => ({ ok: false, failed: false, settled: false, url: '' })),
            { ok: true, url: 'https://www.instagram.com/p/SLOWSHARE123/' },
        ]));
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'slow share eventually succeeds',
        });
        const waitCalls = page.wait.mock.calls.filter((args) => args[0]?.time === 1);
        expect(waitCalls.length).toBeGreaterThanOrEqual(35);
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/SLOWSHARE123/',
            },
        ]);
    });
    it('does not retry the upload flow after Share has already been clicked', async () => {
        const imagePath = createTempImage('no-duplicate-retry.jpg');
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock(withInitialDialogDismiss([
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            ...Array.from({ length: 30 }, () => ({ ok: false, failed: false, url: '' })),
        ]), { setFileInput });
        const cmd = getRegistry().get('instagram/post');
        await expect(cmd.func(page, {
            media: imagePath,
            content: 'share observation stalled',
        })).rejects.toThrow('Instagram post share confirmation did not appear');
        expect(setFileInput).toHaveBeenCalledTimes(1);
    });
    it('recovers the latest post URL from the current logged-in profile when success does not navigate to /p/', async () => {
        const imagePath = createTempImage('url-recovery.jpg');
        const evaluate = vi.fn(async (js) => {
            if (js.includes('const data = Array.isArray(window[') && js.includes('__opencli_ig_protocol_capture')) {
                return { data: [], errors: [] };
            }
            if (js.includes('fetch(') && js.includes('/api/v1/users/') && js.includes('X-IG-App-ID')) {
                return js.includes('dynamic-runtime-app-id')
                    ? { ok: true, username: 'tsezi_ray' }
                    : { ok: false };
            }
            if (js.includes('window.location?.pathname'))
                return { ok: true };
            if (js.includes('data-opencli-ig-upload-index'))
                return { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] };
            if (js.includes("dispatchEvent(new Event('input'"))
                return { ok: true };
            if (js.includes('const hasPreviewUi ='))
                return { ok: true, state: 'preview' };
            if (js.includes("scope === 'media'"))
                return { ok: true, label: 'Next' };
            if (js.includes("scope === 'caption'"))
                return { ok: true, label: 'Share' };
            if (js.includes('post shared') && js.includes('your post has been shared'))
                return { ok: true, url: '' };
            if (js.includes('const hrefs = Array.from(document.querySelectorAll(\'a[href*="/p/"]\'))')) {
                const calls = evaluate.mock.calls.filter(([script]) => typeof script === 'string' && script.includes('const hrefs = Array.from(document.querySelectorAll(\'a[href*="/p/"]\'))')).length;
                return calls === 1
                    ? { ok: true, hrefs: ['/tsezi_ray/p/PINNED111/', '/tsezi_ray/p/OLD222/'] }
                    : { ok: true, hrefs: ['/tsezi_ray/p/PINNED111/', '/tsezi_ray/p/OLD222/', '/tsezi_ray/p/RECOVER123/'] };
            }
            if (js.includes('document.documentElement?.outerHTML')) {
                return {
                    appId: 'dynamic-runtime-app-id',
                    csrfToken: 'csrf-token',
                    instagramAjax: 'dynamic-rollout',
                };
            }
            return { ok: true };
        });
        const page = createPageMock([], {
            evaluate,
            getCookies: vi.fn().mockResolvedValue([{ name: 'ds_user_id', value: '61236465677', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'url recovery',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/tsezi_ray/p/RECOVER123/',
            },
        ]);
    });
    it('treats a closed composer as a successful share and falls back to URL recovery', async () => {
        const imagePath = createTempImage('share-settled.jpg');
        const page = createPageMock([
            { appId: 'dynamic-runtime-app-id', csrfToken: 'csrf-token', instagramAjax: 'dynamic-rollout' },
            { ok: true, username: 'tsezi_ray' },
            { ok: true, hrefs: ['/p/OLD111/'] },
            { ok: false },
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: false, failed: false, settled: true, url: '' },
            { ok: false, failed: false, settled: true, url: '' },
            { ok: false, failed: false, settled: true, url: '' },
            { appId: 'dynamic-runtime-app-id', csrfToken: 'csrf-token', instagramAjax: 'dynamic-rollout' },
            { ok: true, username: 'tsezi_ray' },
            { ok: true, hrefs: ['/p/OLD111/', '/p/RECOVER789/'] },
        ], {
            getCookies: vi.fn().mockResolvedValue([{ name: 'ds_user_id', value: '61236465677', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'share settled recovery',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/RECOVER789/',
            },
        ]);
    });
    it('accepts standard /p/... profile links during URL recovery', async () => {
        const imagePath = createTempImage('url-recovery-standard-shape.jpg');
        const page = createPageMock([
            { appId: 'dynamic-runtime-app-id', csrfToken: 'csrf-token', instagramAjax: 'dynamic-rollout' },
            { ok: true, username: 'tsezi_ray' },
            { ok: true, hrefs: ['/p/PINNED111/', '/p/OLD222/'] },
            { ok: false },
            { ok: true },
            { ok: true, selectors: ['[data-opencli-ig-upload-index="0"]'] },
            { ok: true },
            { ok: true },
            { ok: false },
            { ok: true, label: 'Next' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Share' },
            { ok: true, url: '' },
            { appId: 'dynamic-runtime-app-id', csrfToken: 'csrf-token', instagramAjax: 'dynamic-rollout' },
            { ok: true, username: 'tsezi_ray' },
            { ok: true, hrefs: ['/p/PINNED111/', '/p/OLD222/', '/p/RECOVER456/'] },
        ], {
            getCookies: vi.fn().mockResolvedValue([{ name: 'ds_user_id', value: '61236465677', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/post');
        const result = await cmd.func(page, {
            media: imagePath,
            content: 'url recovery standard shape',
        });
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single image post shared successfully',
                url: 'https://www.instagram.com/p/RECOVER456/',
            },
        ]);
    });
});
