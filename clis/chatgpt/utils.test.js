import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test__, getChatGPTImageAssets, getChatGPTVisibleImageUrls, prepareChatGPTImagePaths, sendChatGPTMessage, uploadChatGPTImages, waitForChatGPTImages } from './utils.js';

const tempDirs = [];

afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

function createPageMock({ location = '', generating = [], imageUrls = [] } = {}) {
    let generatingIndex = 0;
    let imageIndex = 0;
    return {
        wait: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => {
            if (script === 'window.location.href') return Promise.resolve(location);
            if (script.includes('Stop generating') || script.includes('Thinking')) {
                const value = generating[Math.min(generatingIndex, generating.length - 1)] ?? false;
                generatingIndex += 1;
                return Promise.resolve(value);
            }
            if (script.includes("document.querySelectorAll('img')")) {
                const value = imageUrls[Math.min(imageIndex, imageUrls.length - 1)] ?? [];
                imageIndex += 1;
                return Promise.resolve(value);
            }
            return Promise.resolve(undefined);
        }),
    };
}

describe('chatgpt image wait contract', () => {
    it('does not periodically reload the conversation while generation is still active', async () => {
        const convUrl = 'https://chatgpt.com/c/demo';
        const page = createPageMock({
            location: convUrl,
            generating: [true, true, true, true, true, true],
        });

        await expect(waitForChatGPTImages(page, [], 18, convUrl)).resolves.toEqual([]);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('jumps back to the captured conversation when the page drifts away', async () => {
        const convUrl = 'https://chatgpt.com/c/demo';
        const page = createPageMock({
            location: 'https://chatgpt.com/',
            generating: [false],
            imageUrls: [['https://cdn.openai.com/generated/demo.png']],
        });

        await expect(waitForChatGPTImages(page, [], 3, convUrl)).resolves.toEqual([
            'https://cdn.openai.com/generated/demo.png',
        ]);
        expect(page.goto).toHaveBeenCalledWith(convUrl);
    });

    it('treats query and hash variants as the same conversation', () => {
        expect(__test__.isSameChatGPTConversation(
            'https://chatgpt.com/c/demo?model=gpt-image-1',
            'https://chatgpt.com/c/demo',
        )).toBe(true);
        expect(__test__.isSameChatGPTConversation(
            'https://chatgpt.com/c/other',
            'https://chatgpt.com/c/demo',
        )).toBe(false);
    });
});

describe('chatgpt conversation id parsing', () => {
    it('accepts ids and chatgpt conversation URLs', () => {
        expect(__test__.parseChatGPTConversationId('abc_123-def')).toBe('abc_123-def');
        expect(__test__.parseChatGPTConversationId('https://chatgpt.com/c/abc_123-def?model=gpt-5')).toBe('abc_123-def');
        expect(__test__.parseChatGPTConversationId('/c/abc_123-def')).toBe('abc_123-def');
    });

    it('rejects invalid detail ids', () => {
        expect(() => __test__.parseChatGPTConversationId('')).toThrow(/conversation id/);
        expect(() => __test__.parseChatGPTConversationId('https://chatgpt.com/')).toThrow(/conversation id/);
    });
});

describe('chatgpt send selectors', () => {
    it('inlines the composer locator without returning before caller code runs', () => {
        const dom = new JSDOM('<!doctype html><div id="prompt-textarea" contenteditable="true"></div>', {
            url: 'https://chatgpt.com/',
            runScripts: 'outside-only',
        });
        const composer = dom.window.document.querySelector('#prompt-textarea');
        composer.getBoundingClientRect = () => ({ width: 320, height: 48 });

        const result = dom.window.eval(`
            (() => {
                ${__test__.buildComposerLocatorScript()}
                const composer = findComposer();
                return !!composer && composer.getAttribute(markerAttr) === '1';
            })()
        `);

        expect(result).toBe(true);
    });

    it('keeps locale-independent send-button selector before aria-label fallbacks', async () => {
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            nativeType: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script.includes('findComposer')) return Promise.resolve(true);
                if (script.includes('sendBtnFound')) {
                    expect(script).toContain('data-testid=\\\"send-button\\\"');
                    return Promise.resolve({ sendBtnFound: true });
                }
                if (script.includes('if (sendBtn) sendBtn.click')) {
                    expect(script).toContain('data-testid=\\\"send-button\\\"');
                }
                return Promise.resolve(undefined);
            }),
        };

        await expect(sendChatGPTMessage(page, 'hello')).resolves.toBe(true);
    });

    it('uses the composer submit fallback consistently for readiness and click', async () => {
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            nativeType: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script.includes('findComposer')) return Promise.resolve(true);
                if (script.includes('sendBtnFound')) {
                    expect(script).toContain('#composer-submit-button:not([disabled])');
                    return Promise.resolve({ sendBtnFound: true });
                }
                if (script.includes('if (sendBtn) sendBtn.click')) {
                    expect(script).toContain('#composer-submit-button:not([disabled])');
                }
                return Promise.resolve(undefined);
            }),
        };

        await expect(sendChatGPTMessage(page, 'hello')).resolves.toBe(true);
    });

    it('keeps zh-CN aria and placeholder fallbacks without replacing English selectors', () => {
        expect(__test__.COMPOSER_SELECTORS).toEqual(expect.arrayContaining([
            '[aria-label="Chat with ChatGPT"]',
            '[aria-label="与 ChatGPT 聊天"]',
            '[placeholder="Ask anything"]',
            '[placeholder="有问题，尽管问"]',
            '[data-testid="prompt-textarea"]',
        ]));
        expect(__test__.SEND_BUTTON_SELECTOR).toBe('button[data-testid="send-button"]:not([disabled])');
        expect(__test__.SEND_BUTTON_FALLBACK_SELECTORS).toContain('#composer-submit-button:not([disabled])');
        expect(__test__.SEND_BUTTON_LABELS).toEqual(expect.arrayContaining(['Send prompt', 'Send message', 'Send', '发送提示']));
        expect(__test__.CLOSE_SIDEBAR_LABELS).toEqual(expect.arrayContaining(['Close sidebar', '关闭边栏']));
    });
});

describe('chatgpt generated image detection', () => {
    function createDomPage(html, setup = () => {}) {
        const dom = new JSDOM(html, {
            url: 'https://chatgpt.com/c/demo',
            runScripts: 'outside-only',
        });
        setup(dom.window);
        return {
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(String(script)))),
        };
    }

    it('detects visible CSS background images when ChatGPT does not render a plain img', async () => {
        const page = createDomPage(`
            <!doctype html>
            <main>
              <div class="avatar" style="background-image: url('https://chatgpt.com/avatar.png')"></div>
              <button data-testid="generated-image" style="background-image: url('/backend-api/generated/foo.webp')"></button>
            </main>
        `, (window) => {
            for (const el of window.document.querySelectorAll('div, button')) {
                el.getBoundingClientRect = () => ({ width: 512, height: 512 });
            }
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'https://chatgpt.com/backend-api/generated/foo.webp',
        ]);
    });

    it('detects visible generated canvases as data URLs when they contain pixels', async () => {
        const page = createDomPage('<!doctype html><canvas width="512" height="512"></canvas>', (window) => {
            const canvas = window.document.querySelector('canvas');
            canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
            canvas.getContext = () => ({
                getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
            });
            canvas.toDataURL = () => 'data:image/png;base64,ZmFrZQ==';
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'data:image/png;base64,ZmFrZQ==',
        ]);
    });

    it('samples generated canvas content outside the top-left corner', async () => {
        const page = createDomPage('<!doctype html><canvas width="512" height="512"></canvas>', (window) => {
            const canvas = window.document.querySelector('canvas');
            canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
            canvas.getContext = () => ({
                getImageData: (x, y) => ({
                    data: x > 480 && y > 480
                        ? new Uint8ClampedArray([255, 0, 0, 255])
                        : new Uint8ClampedArray([0, 0, 0, 0]),
                }),
            });
            canvas.toDataURL = () => 'data:image/png;base64,lower-right';
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'data:image/png;base64,lower-right',
        ]);
    });

    it('samples generated canvas content near the center', async () => {
        const page = createDomPage('<!doctype html><canvas width="512" height="512"></canvas>', (window) => {
            const canvas = window.document.querySelector('canvas');
            canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
            canvas.getContext = () => ({
                getImageData: (x, y) => {
                    const inCenter = x >= 240 && x <= 272 && y >= 240 && y <= 272;
                    return { data: new Uint8ClampedArray(inCenter ? [0, 80, 200, 255] : [255, 255, 255, 255]) };
                },
            });
            canvas.toDataURL = () => 'data:image/png;base64,center';
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'data:image/png;base64,center',
        ]);
    });

    it('ignores transparent placeholder canvases', async () => {
        const page = createDomPage('<!doctype html><canvas width="512" height="512"></canvas>', (window) => {
            const canvas = window.document.querySelector('canvas');
            canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
            canvas.getContext = () => ({
                getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }),
            });
            canvas.toDataURL = () => 'data:image/png;base64,blank';
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([]);
    });

    it('ignores user-uploaded reference image previews', async () => {
        const page = createDomPage(`
            <!doctype html>
            <section data-testid="conversation-turn-1">
              <h4>You said:</h4>
              <button aria-label="Open image: reference.png">
                <img alt="reference.png" src="https://chatgpt.com/backend-api/uploaded/reference.png">
              </button>
            </section>
            <section data-testid="conversation-turn-2">
              <h4>ChatGPT said:</h4>
              <img alt="generated image" src="https://chatgpt.com/backend-api/generated/foo.webp">
            </section>
        `, (window) => {
            for (const img of window.document.querySelectorAll('img')) {
                Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 512 });
                Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 512 });
                img.getBoundingClientRect = () => ({ width: 512, height: 512 });
            }
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'https://chatgpt.com/backend-api/generated/foo.webp',
        ]);
    });

    it('keeps assistant generated images even when they are inside an open-image button', async () => {
        const page = createDomPage(`
            <!doctype html>
            <section data-testid="conversation-turn-2">
              <h4>ChatGPT said:</h4>
              <button aria-label="Open image: generated image">
                <img alt="generated image" src="https://chatgpt.com/backend-api/generated/foo.webp">
              </button>
            </section>
        `, (window) => {
            const img = window.document.querySelector('img');
            Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 512 });
            Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 512 });
            img.getBoundingClientRect = () => ({ width: 512, height: 512 });
        });

        await expect(getChatGPTVisibleImageUrls(page)).resolves.toEqual([
            'https://chatgpt.com/backend-api/generated/foo.webp',
        ]);
    });

    it('exports assets for generated CSS background images', async () => {
        const imageUrl = 'https://chatgpt.com/backend-api/generated/foo.webp';
        const page = createDomPage(`
            <!doctype html>
            <button style="background-image: url('/backend-api/generated/foo.webp')"></button>
        `, (window) => {
            const button = window.document.querySelector('button');
            button.getBoundingClientRect = () => ({ width: 512, height: 512 });
            window.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: async () => new window.Blob(['fake-image'], { type: 'image/webp' }),
            });
        });

        await expect(getChatGPTImageAssets(page, [imageUrl])).resolves.toEqual([
            expect.objectContaining({
                url: imageUrl,
                mimeType: 'image/webp',
                width: 512,
                height: 512,
            }),
        ]);
    });
});

describe('chatgpt image upload helper', () => {
    it('validates local images without a browser page', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake-png');

        await expect(prepareChatGPTImagePaths([filePath])).resolves.toEqual({ ok: true, paths: [filePath] });
        await expect(prepareChatGPTImagePaths([path.join(dir, 'missing.png')])).resolves.toMatchObject({
            ok: false,
            reason: expect.stringContaining('Image not found'),
        });
    });

    it('prefers Browser Bridge file input upload and waits for a preview', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake-png');

        const page = {
            setFileInput: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(true),
        };

        const result = await uploadChatGPTImages(page, [filePath]);

        expect(result).toEqual({ ok: true, files: [filePath] });
        expect(page.setFileInput).toHaveBeenCalledWith([filePath], 'input[type="file"]');
    });

    it('rejects missing files before touching the page', async () => {
        const page = {
            setFileInput: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };

        const result = await uploadChatGPTImages(page, ['/no/such/cat.png']);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Image not found');
        expect(page.setFileInput).not.toHaveBeenCalled();
    });

    it('rejects non-image extensions', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'report.pdf');
        fs.writeFileSync(filePath, 'fake');

        const page = {
            setFileInput: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };

        const result = await uploadChatGPTImages(page, [filePath]);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Unsupported image type');
        expect(page.setFileInput).not.toHaveBeenCalled();
    });

    it('passes a React-compatible change event in fallback upload', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake-png');

        const page = {
            setFileInput: vi.fn().mockRejectedValue(new Error('No element found')),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (String(script).includes('new DataTransfer()')) {
                    return Promise.resolve({ ok: true });
                }
                return Promise.resolve(true);
            }),
        };

        const result = await uploadChatGPTImages(page, [filePath]);

        expect(result).toEqual({ ok: true, files: [filePath] });
        const fallbackScript = page.evaluate.mock.calls
            .map(([script]) => String(script))
            .find(script => script.includes('new DataTransfer()'));
        expect(fallbackScript).toContain('preventDefault()');
        expect(fallbackScript).toContain('stopPropagation()');
    });

    it('does not treat generic upload controls as uploaded image previews', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake-png');

        const dom = new JSDOM(`
            <!doctype html>
            <main>
              <div aria-label="Chat with ChatGPT">
                <button class="upload-button" data-testid="upload-button">Attach</button>
              </div>
            </main>
        `, { url: 'https://chatgpt.com/new', runScripts: 'outside-only' });
        const page = {
            setFileInput: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(String(script)))),
        };

        const result = await uploadChatGPTImages(page, [filePath]);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('image upload preview did not appear');
    });

    it('accepts a real uploaded media preview even when the filename text is absent', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake-png');

        const dom = new JSDOM(`
            <!doctype html>
            <main>
              <div aria-label="Chat with ChatGPT">
                <img src="blob:https://chatgpt.com/upload-preview">
              </div>
            </main>
        `, { url: 'https://chatgpt.com/new', runScripts: 'outside-only' });
        const img = dom.window.document.querySelector('img');
        Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 512 });
        Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 512 });
        img.getBoundingClientRect = () => ({ width: 512, height: 512 });
        const page = {
            setFileInput: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(String(script)))),
        };

        await expect(uploadChatGPTImages(page, [filePath])).resolves.toEqual({ ok: true, files: [filePath] });
    });

    it('exposes image MIME inference for fallback upload', () => {
        expect(__test__.imageMimeFromPath('/tmp/a.png')).toBe('image/png');
        expect(__test__.imageMimeFromPath('/tmp/a.webp')).toBe('image/webp');
        expect(__test__.imageMimeFromPath('/tmp/a.jpg')).toBe('image/jpeg');
    });
});
