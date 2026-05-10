import { describe, expect, it, vi } from 'vitest';
import { __test__, sendChatGPTMessage, waitForChatGPTImages } from './utils.js';

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

    it('keeps zh-CN aria and placeholder fallbacks without replacing English selectors', () => {
        expect(__test__.COMPOSER_SELECTORS).toEqual(expect.arrayContaining([
            '[aria-label="Chat with ChatGPT"]',
            '[aria-label="与 ChatGPT 聊天"]',
            '[placeholder="Ask anything"]',
            '[placeholder="有问题，尽管问"]',
            '[data-testid="prompt-textarea"]',
        ]));
        expect(__test__.SEND_BUTTON_SELECTOR).toBe('button[data-testid="send-button"]:not([disabled])');
        expect(__test__.SEND_BUTTON_LABELS).toEqual(expect.arrayContaining(['Send prompt', 'Send message', 'Send', '发送提示']));
        expect(__test__.CLOSE_SIDEBAR_LABELS).toEqual(expect.arrayContaining(['Close sidebar', '关闭边栏']));
    });
});
