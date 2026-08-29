import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { exportGeminiImages, getGeminiVisibleImageUrls, waitForGeminiImages } from './utils.js';

const CONVERSATION_URL = 'https://gemini.google.com/app/abc123';
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * Build a page whose evaluate runs the generated scripts against a JSDOM
 * conversation, with the generation state supplied per poll.
 */
function createPageMock({ generating = [false] } = {}) {
    const dom = new JSDOM('<main></main>', { url: CONVERSATION_URL, runScripts: 'outside-only' });
    let index = 0;
    return {
        dom,
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => {
            if (script === 'window.location.href') return Promise.resolve(CONVERSATION_URL);
            if (script.includes('stop response')) {
                const value = generating[Math.min(index, generating.length - 1)] ?? false;
                index += 1;
                return typeof value === 'boolean' ? Promise.resolve(value) : Promise.reject(new Error('probe failed'));
            }
            return Promise.resolve(dom.window.eval(script));
        }),
    };
}

function wrapEvaluate(page) {
    const original = page.evaluate;
    page.evaluate = vi.fn(async (script) => ({ session: 'site:gemini', data: await original(script) }));
    return page;
}

/** Mount an image whose decode state and layout box are controlled per case. */
function mountImage(dom, { src, naturalWidth, complete, box = 708 }) {
    dom.window.document.querySelector('main').innerHTML = `<img src="${src}" alt="AI generated">`;
    const img = dom.window.document.querySelector('main img');
    Object.defineProperty(img, 'complete', { value: complete });
    Object.defineProperty(img, 'naturalWidth', { value: naturalWidth });
    Object.defineProperty(img, 'naturalHeight', { value: naturalWidth });
    Object.defineProperty(img, 'width', { value: box });
    Object.defineProperty(img, 'height', { value: box });
    img.getBoundingClientRect = () => ({ width: box, height: box });
    return img;
}

/** Answer the in-page fetch with a blob of the given type. */
function stubFetch(dom, { type }) {
    dom.window.fetch = () => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve({ type }),
    });
    dom.window.FileReader = class {
        readAsDataURL(blob) {
            this.result = blob.type === 'image/png' ? PNG_DATA_URL : 'data:text/html;base64,PGh0bWw+';
            this.onloadend?.();
        }
    };
}

describe('gemini image detection', () => {
    it('ignores an image that is still streaming its bytes', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/pending', naturalWidth: 0, complete: false });

        await expect(getGeminiVisibleImageUrls(page)).resolves.toEqual([]);
    });

    it('ignores an image that finished loading without decodable bytes', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/broken', naturalWidth: 0, complete: true });

        await expect(getGeminiVisibleImageUrls(page)).resolves.toEqual([]);
    });

    it('ignores an image that reports dimensions before it finished loading', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/partial', naturalWidth: 1024, complete: false });

        await expect(getGeminiVisibleImageUrls(page)).resolves.toEqual([]);
    });

    it('accepts a decoded generated image', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/generated.png', naturalWidth: 1024, complete: true });

        await expect(getGeminiVisibleImageUrls(page)).resolves.toEqual([
            'https://lh3.googleusercontent.com/generated.png',
        ]);
    });

    it('unwraps Browser Bridge envelopes before returning image URLs', async () => {
        const page = wrapEvaluate(createPageMock());
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/generated.png', naturalWidth: 1024, complete: true });

        await expect(getGeminiVisibleImageUrls(page)).resolves.toEqual([
            'https://lh3.googleusercontent.com/generated.png',
        ]);
    });
});

describe('gemini image wait contract', () => {
    it('does not settle on the page while Gemini is still generating', async () => {
        const page = createPageMock({ generating: [true] });
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/mid.png', naturalWidth: 1024, complete: true });

        await expect(waitForGeminiImages(page, [], 9)).rejects.toThrow(/gemini image timed out/);
    });

    it('fails closed when the generation probe stops answering', async () => {
        const page = createPageMock({ generating: [true, 'unreadable'] });

        await expect(waitForGeminiImages(page, [], 9)).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('does not accept a visible image when the first generation probe fails', async () => {
        const page = createPageMock({ generating: ['unreadable'] });
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/unknown-state.png', naturalWidth: 1024, complete: true });

        await expect(waitForGeminiImages(page, [], 9)).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('drops candidate images if the generation probe resumes as still generating', async () => {
        const page = createPageMock({ generating: [false, true, true] });
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/transient.png', naturalWidth: 1024, complete: true });

        await expect(waitForGeminiImages(page, [], 9)).rejects.toThrow(/gemini image timed out/);
    });

    it('returns the image once generation has stopped', async () => {
        const page = createPageMock({ generating: [false] });
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/final.png', naturalWidth: 1024, complete: true });

        await expect(waitForGeminiImages(page, [], 9)).resolves.toEqual([
            'https://lh3.googleusercontent.com/final.png',
        ]);
    });

    it('unwraps Browser Bridge envelopes before reading the generation probe', async () => {
        const page = wrapEvaluate(createPageMock({ generating: [true] }));
        mountImage(page.dom, { src: 'https://lh3.googleusercontent.com/mid.png', naturalWidth: 1024, complete: true });

        await expect(waitForGeminiImages(page, [], 9)).rejects.toThrow(/gemini image timed out/);
    });

    it('resolves empty when generation finished without producing an image', async () => {
        const page = createPageMock({ generating: [false] });

        await expect(waitForGeminiImages(page, [], 9)).resolves.toEqual([]);
    });
});

describe('gemini image export', () => {
    it('exports an image whose blob carries an image type', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/ok', naturalWidth: 1024, complete: true });
        stubFetch(page.dom, { type: 'image/png' });

        await expect(exportGeminiImages(page, ['blob:https://gemini.google.com/ok'])).resolves.toEqual([
            expect.objectContaining({ dataUrl: PNG_DATA_URL, mimeType: 'image/png' }),
        ]);
    });

    it('unwraps Browser Bridge envelopes before returning exported assets', async () => {
        const page = wrapEvaluate(createPageMock());
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/ok', naturalWidth: 1024, complete: true });
        stubFetch(page.dom, { type: 'image/png' });

        await expect(exportGeminiImages(page, ['blob:https://gemini.google.com/ok'])).resolves.toEqual([
            expect.objectContaining({ dataUrl: PNG_DATA_URL, mimeType: 'image/png' }),
        ]);
    });

    it('fails closed when Browser Bridge returns malformed exported assets', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href')
                    return Promise.resolve(CONVERSATION_URL);
                return Promise.resolve({
                    session: 'site:gemini',
                    data: [{ dataUrl: PNG_DATA_URL, mimeType: 'image/png' }],
                });
            }),
        };

        await expect(exportGeminiImages(page, ['blob:https://gemini.google.com/bad'])).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('drops a response that came back as a page instead of an image', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/error', naturalWidth: 1024, complete: true });
        stubFetch(page.dom, { type: 'text/html' });

        await expect(exportGeminiImages(page, ['blob:https://gemini.google.com/error'])).resolves.toEqual([]);
    });

    it('does not redraw an image whose bytes never decoded', async () => {
        const page = createPageMock();
        mountImage(page.dom, { src: 'blob:https://gemini.google.com/blank', naturalWidth: 0, complete: false });
        page.dom.window.fetch = () => Promise.reject(new Error('CORS'));
        const drawImage = vi.fn();
        page.dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage });
        page.dom.window.HTMLCanvasElement.prototype.toDataURL = () => PNG_DATA_URL;

        await expect(exportGeminiImages(page, ['blob:https://gemini.google.com/blank'])).resolves.toEqual([]);
        expect(drawImage).not.toHaveBeenCalled();
    });
});
