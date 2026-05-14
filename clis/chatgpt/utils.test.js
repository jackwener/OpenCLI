import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test__, getVisibleMessages, prepareChatGPTImagePaths, revealChatGPTConversation, sendChatGPTMessage, uploadChatGPTImages, waitForChatGPTImages } from './utils.js';

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
        expect(__test__.OPEN_SIDEBAR_LABELS).toEqual(expect.arrayContaining(['Open sidebar', '開啟側邊欄', '打开边栏']));
    });
});

describe('chatgpt history extraction', () => {
    it('accepts sidebar links whose visible box is on a child node', async () => {
        const dom = new JSDOM(`
            <nav aria-label="聊天歷程紀錄">
              <div id="history">
                <a href="/c/6a0522ba-89b4-83a2-9bc2-7a10eb6559c3" aria-label="Synology macOS App統計">
                  <span>Synology macOS App統計</span>
                </a>
              </div>
            </nav>
        `, { url: 'https://chatgpt.com/', runScripts: 'dangerously' });
        const anchor = dom.window.document.querySelector('a');
        const span = dom.window.document.querySelector('span');
        anchor.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });
        span.getBoundingClientRect = () => ({ x: 12, y: 20, width: 180, height: 24, top: 20, left: 12, bottom: 44, right: 192 });

        const page = {
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(script))),
        };

        await expect(__test__.extractConversationLinks(page)).resolves.toEqual([{
            Index: 1,
            Id: '6a0522ba-89b4-83a2-9bc2-7a10eb6559c3',
            Title: 'Synology macOS App統計',
            Url: 'https://chatgpt.com/c/6a0522ba-89b4-83a2-9bc2-7a10eb6559c3',
        }]);
    });

    it('parses ChatGPT conversation links from OpenCLI snapshots', () => {
        const snapshot = `
            <div id=history />
              <ul />
                <li />
                  [47]<a tabindex=0 aria-label=Synology macOS App統計 href=/c/6a0522ba-89b4-83a2-9bc2-7a10eb6559c3 />
                <li />
                  [48]<a tabindex=0 aria-label="MTP vs DFlash 性能" href=/c/6a0447bb-a1dc-8320-a8bd-0902d2068dea />
        `;

        expect(__test__.parseConversationLinksFromSnapshot(snapshot)).toEqual([
            {
                Index: 1,
                Id: '6a0522ba-89b4-83a2-9bc2-7a10eb6559c3',
                Title: 'Synology macOS App統計',
                Url: 'https://chatgpt.com/c/6a0522ba-89b4-83a2-9bc2-7a10eb6559c3',
            },
            {
                Index: 2,
                Id: '6a0447bb-a1dc-8320-a8bd-0902d2068dea',
                Title: 'MTP vs DFlash 性能',
                Url: 'https://chatgpt.com/c/6a0447bb-a1dc-8320-a8bd-0902d2068dea',
            },
        ]);
    });
});

describe('chatgpt visible message extraction', () => {
    it('reads section-based ChatGPT conversation turns in localized UI', async () => {
        const dom = new JSDOM(`
            <main>
              <section data-testid="conversation-turn-1">
                <h4>你說：</h4>
                <div data-testid="collapsible-user-message-content">搜尋 synology 官網的下載頁面.</div>
              </section>
              <section data-testid="conversation-turn-2">
                <h4>ChatGPT 說：</h4>
                <div>
                  <p>統計結果：23 種 macOS native app</p>
                  <button aria-label="複製回應">copy</button>
                </div>
              </section>
            </main>
        `, { url: 'https://chatgpt.com/c/demo', runScripts: 'dangerously' });
        for (const node of dom.window.document.querySelectorAll('section')) {
            node.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });
        }
        for (const node of dom.window.document.querySelectorAll('[data-testid="collapsible-user-message-content"], p')) {
            node.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 20, top: 0, left: 0, bottom: 20, right: 300 });
        }

        const page = {
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(script))),
        };

        await expect(getVisibleMessages(page)).resolves.toMatchObject([
            { Index: 1, Role: 'User', Text: expect.stringContaining('搜尋 synology') },
            { Index: 2, Role: 'Assistant', Text: expect.stringContaining('統計結果') },
        ]);
    });

    it('parses localized conversation turns from OpenCLI snapshots', () => {
        const snapshot = { data: `
            <section data-testid=conversation-turn-1 />
              <h4>你說：</h4>
              <div>搜尋 synology 官網的下載頁面.</div>
            <section data-testid=conversation-turn-2 />
              <h4>ChatGPT 說：</h4>
              <p>判斷標準：最新版本目錄中有 macOS 安裝檔。</p>
              |table|
              | # | macOS native app |
              | 1 | Synology Drive Client |
              <div aria-label=回覆操作 role=group tabindex=-1 />
            <div id=thread-bottom-container />
        ` };

        expect(__test__.parseMessagesFromSnapshot(snapshot)).toEqual([
            {
                Index: 1,
                Role: 'User',
                Text: '搜尋 synology 官網的下載頁面.',
                Html: '',
            },
            {
                Index: 2,
                Role: 'Assistant',
                Text: [
                    '判斷標準：最新版本目錄中有 macOS 安裝檔。',
                    '| # | macOS native app |',
                    '| 1 | Synology Drive Client |',
                ].join('\n'),
                Html: '',
            },
        ]);
    });

    it('scrolls chat containers back to the top when a conversation opens below rendered turns', async () => {
        const dom = new JSDOM(`
            <main style="height: 100px; overflow: auto">
              <div style="height: 1000px"></div>
            </main>
        `, { url: 'https://chatgpt.com/c/demo', runScripts: 'dangerously' });
        const main = dom.window.document.querySelector('main');
        Object.defineProperty(main, 'clientHeight', { value: 100 });
        Object.defineProperty(main, 'scrollHeight', { value: 1000 });
        main.scrollTop = 900;

        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(script))),
        };

        await revealChatGPTConversation(page);

        expect(main.scrollTop).toBe(0);
        expect(page.wait).toHaveBeenCalledWith(1);
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
                return Promise.resolve({ ok: true });
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

    it('exposes image MIME inference for fallback upload', () => {
        expect(__test__.imageMimeFromPath('/tmp/a.png')).toBe('image/png');
        expect(__test__.imageMimeFromPath('/tmp/a.webp')).toBe('image/webp');
        expect(__test__.imageMimeFromPath('/tmp/a.jpg')).toBe('image/jpeg');
    });
});
