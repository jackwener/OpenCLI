import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__, getChatGPTDetailRows, getChatGPTImageAssets, getChatGPTResponsePairCounts, getChatGPTVisibleImageUrls, getCurrentChatGPTModel, getCurrentChatGPTTool, isGenerating, navigateToProject, openChatGPTConversation, prepareChatGPTImagePaths, selectChatGPTModel, selectChatGPTTool, sendChatGPTMessage, uploadChatGPTImages, waitForChatGPTDetailRows, waitForChatGPTImages, waitForChatGPTResponse } from './utils.js';

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

function createDomEvaluatePage(html) {
    const dom = new JSDOM(html, {
        url: 'https://chatgpt.com/',
        runScripts: 'outside-only',
    });
    for (const node of dom.window.document.querySelectorAll('form, button, [role="menuitemradio"], [role="menuitem"], [role="option"], #prompt-textarea, [data-testid]')) {
        node.getBoundingClientRect = () => ({ width: 120, height: 36 });
        node.scrollIntoView = () => {};
    }
    return {
        dom,
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(script))),
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
        expect(__test__.parseChatGPTConversationId('https://chat.openai.chatgpt.com/c/abc_123-def')).toBe('abc_123-def');
        expect(__test__.parseChatGPTConversationId('https://chatgpt.com/g/g-p-12345678-demo/c/abc_123-def')).toBe('abc_123-def');
        expect(__test__.parseChatGPTConversationId('/c/abc_123-def')).toBe('abc_123-def');
        expect(__test__.parseChatGPTConversationId('/g/g-p-12345678-demo/c/abc_123-def')).toBe('abc_123-def');
    });

    it('rejects invalid detail ids', () => {
        expect(() => __test__.parseChatGPTConversationId('')).toThrow(/conversation id/);
        expect(() => __test__.parseChatGPTConversationId('https://chatgpt.com/')).toThrow(/conversation id/);
    });

    it('rejects off-domain or ambiguous conversation URLs before routing writes', () => {
        expect(() => __test__.parseChatGPTConversationId('https://evil.test/c/abc_123-def')).toThrow(/chatgpt\.com/);
        expect(() => __test__.parseChatGPTConversationId('http://chatgpt.com/c/abc_123-def')).toThrow(/chatgpt\.com/);
        expect(() => __test__.parseChatGPTConversationId('https://chatgpt.com.evil.test/c/abc_123-def')).toThrow(/chatgpt\.com/);
        expect(() => __test__.parseChatGPTConversationId('/c/abc_123-def/extra')).toThrow(/conversation id/);
        expect(() => __test__.parseChatGPTConversationId('prefix https://chatgpt.com/c/abc_123-def')).toThrow(/conversation id/);
    });
});

describe('chatgpt conversation navigation', () => {
    it('opens conversation URLs by parsed id', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
        };

        await expect(openChatGPTConversation(page, 'https://chatgpt.com/c/abc_123-def?model=gpt-5'))
            .resolves.toBe('abc_123-def');
        expect(page.goto).toHaveBeenCalledWith('https://chatgpt.com/c/abc_123-def', { settleMs: 2000 });
        expect(page.wait).toHaveBeenCalledWith({ selector: '#prompt-textarea, [data-testid="prompt-textarea"]', timeout: 8 });
    });
});

function makeDeepResearchReport() {
    return [
        '# Executive Summary',
        '',
        'This completed Deep Research report is intentionally long enough to pass extraction heuristics.',
        'It summarizes findings, constraints, evidence, and recommendations from multiple public sources.',
        'The extraction path should read this markdown from metadata.chatgpt_sdk.widget_state.report_message.content.parts[0].',
        'Using the conversation payload avoids the cross-origin internal deep research iframe boundary.',
        'The report body includes repeated detail so the parser treats it as a real report, not a short UI preview.',
        'Findings show that reliable automation should prefer captured backend conversation JSON over iframe DOM access.',
        'Recommendations include returning diagnostics when no report is present and bounding source extraction.',
        'References and Sources are represented in metadata content references, safe URLs, and search result groups.',
        'Additional detail confirms that source de-duplication should key by URL and keep a readable title.',
        'This paragraph pads the fixture with realistic report text for the minimum-length guard.',
        'Another paragraph pads the fixture with realistic report text for the minimum-length guard.',
        'A final paragraph pads the fixture with realistic report text for the minimum-length guard.',
        '',
        '## Sources',
        '',
        '- Example source',
    ].join('\n');
}

function makeDeepResearchPayload(report = makeDeepResearchReport(), { conversationId = '' } = {}) {
    const payload = {
        mapping: {
            report_node: {
                message: {
                    metadata: {
                        chatgpt_sdk: {
                            widget_state: JSON.stringify({
                                status: 'completed',
                                report_message: {
                                    id: 'report-msg',
                                    content: { parts: [report] },
                                    metadata: {
                                        content_references: [
                                            { title: 'Reference A', url: 'https://example.com/a' },
                                            { matched_text: 'Matched B', url: 'https://example.com/b' },
                                        ],
                                        safe_urls: ['https://example.com/c'],
                                        search_result_groups: [
                                            { entries: [{ title: 'Reference D', url: 'https://example.com/d' }] },
                                        ],
                                    },
                                },
                            }),
                        },
                    },
                },
            },
        },
    };
    if (conversationId) payload.conversation_id = conversationId;
    return payload;
}

describe('chatgpt deep research result extraction', () => {
    it('extracts report markdown and sources from conversation widget_state', () => {
        const result = __test__.extractDeepResearchFromConversationPayload(makeDeepResearchPayload());

        expect(result).toMatchObject({
            status: 'completed',
            method: 'conversation-widget-state',
            reportMessageId: 'report-msg',
            reportLength: expect.any(Number),
        });
        expect(result.report).toContain('Executive Summary');
        expect(result.sources).toEqual(expect.arrayContaining([
            { title: 'Reference A', url: 'https://example.com/a' },
            { title: 'Matched B', url: 'https://example.com/b' },
            { title: '', url: 'https://example.com/c' },
            { title: 'Reference D', url: 'https://example.com/d' },
        ]));
    });

    it('extracts the requested report from captured conversation network entries', () => {
        const shorterReport = `${makeDeepResearchReport()}\n\nshort`;
        const longerReport = `${makeDeepResearchReport()}\n\nAdditional longer section.`;
        const result = __test__.extractDeepResearchFromNetworkEntries([
            { url: 'https://chatgpt.com/backend-api/bootstrap', responsePreview: '{}' },
            {
                url: 'https://chatgpt.com/backend-api/conversation/requested123',
                responsePreview: JSON.stringify(makeDeepResearchPayload(shorterReport, { conversationId: 'requested123' })),
            },
            {
                url: 'https://chatgpt.com/backend-api/conversation/stale45678',
                responsePreview: JSON.stringify(makeDeepResearchPayload(longerReport, { conversationId: 'stale45678' })),
            },
        ], { expectedConversationId: 'requested123' });

        expect(result.method).toBe('network-conversation-widget-state');
        expect(result.networkUrl).toContain('/conversation/requested123');
        expect(result.report).not.toContain('Additional longer section');
    });

    it('typed-fails when the conversation payload id does not match the requested id', () => {
        expect(() => __test__.extractDeepResearchFromConversationPayload(
            makeDeepResearchPayload(makeDeepResearchReport(), { conversationId: 'stale45678' }),
            { expectedConversationId: 'requested123' },
        )).toThrow(CommandExecutionError);
    });

    it('typed-fails malformed source rows instead of silently dropping them', () => {
        const payload = makeDeepResearchPayload();
        const widget = JSON.parse(payload.mapping.report_node.message.metadata.chatgpt_sdk.widget_state);
        widget.report_message.metadata.search_result_groups = [
            { entries: [{ title: 'Source without URL' }] },
        ];
        payload.mapping.report_node.message.metadata.chatgpt_sdk.widget_state = JSON.stringify(widget);

        expect(() => __test__.extractDeepResearchFromConversationPayload(payload))
            .toThrow(CommandExecutionError);
    });

    it('typed-fails malformed conversation payloads instead of treating them as empty reports', () => {
        expect(() => __test__.extractDeepResearchFromConversationPayload({}))
            .toThrow(CommandExecutionError);
    });

    it('ignores short widget previews that are not completed reports', () => {
        expect(__test__.extractDeepResearchFromConversationPayload(makeDeepResearchPayload('short preview'))).toBeNull();
    });
});

describe('chatgpt model selection validation', () => {
    it('rejects unknown model names', async () => {
        await expect(selectChatGPTModel({ nativeClick: vi.fn() }, 'unknown'))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(selectChatGPTModel({ nativeClick: vi.fn() }, 'unknown'))
            .rejects.toThrow('Unknown ChatGPT model "unknown"');
    });

    it('requires native browser click support', async () => {
        await expect(selectChatGPTModel({}, 'pro'))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(selectChatGPTModel({}, 'pro'))
            .rejects.toThrow('ChatGPT model selection requires native browser click support.');
    });

    it('clicks the model selector and verifies the selected postcondition', async () => {
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 3) return Promise.resolve({ found: true, x: 10, y: 20 });
                if (objectCall === 4) return Promise.resolve({ found: true, x: 30, y: 40 });
                if (objectCall === 5) return Promise.resolve({ model: 'fast', label: 'Fast' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'fast')).resolves.toEqual({ Status: 'Success', Model: 'Fast' });
        expect(page.nativeClick).toHaveBeenNthCalledWith(1, 10, 20);
        expect(page.nativeClick).toHaveBeenNthCalledWith(2, 30, 40);
    });

    it('sets Advanced through the ChatGPT model config API when browser cookies are available', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: '__Secure-next-auth.session-token', value: 'cookie', domain: '.chatgpt.com' }]),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                if (String(script).includes('oai-last-model-config')) return Promise.resolve(true);
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 3) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 4) return Promise.resolve({ model: 'advanced', label: 'Advanced' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'thinking')).resolves.toEqual({ Status: 'Success', Model: 'Advanced' });
        expect(fetchMock.mock.calls[1][0]).toContain('/backend-api/settings/user_last_used_model_config');
        expect(fetchMock.mock.calls[1][0]).toContain('model_slug=gpt-5-5-thinking');
        expect(fetchMock.mock.calls[1][0]).toContain('thinking_effort=extended');
        expect(page.nativeClick).not.toHaveBeenCalled();
    });

    it('falls back to the visible picker when the model config API does not prove selection', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: '__Secure-next-auth.session-token', value: 'cookie', domain: '.chatgpt.com' }]),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                if (String(script).includes('oai-last-model-config')) return Promise.resolve(true);
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 3) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 4) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 5) return Promise.resolve({ found: true, x: 10, y: 20 });
                if (objectCall === 6) return Promise.resolve({ found: true, x: 30, y: 40 });
                if (objectCall === 7) return Promise.resolve({ model: 'advanced', label: 'Advanced' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'advanced')).resolves.toEqual({ Status: 'Success', Model: 'Advanced' });
        expect(page.nativeClick).toHaveBeenNthCalledWith(1, 10, 20);
        expect(page.nativeClick).toHaveBeenNthCalledWith(2, 30, 40);
    });

    it('falls back to the picker when the session API response is malformed', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('{', { status: 200 }));
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: '__Secure-next-auth.session-token', value: 'cookie', domain: '.chatgpt.com' }]),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 3) return Promise.resolve({ found: true, x: 10, y: 20 });
                if (objectCall === 4) return Promise.resolve({ found: true, x: 30, y: 40 });
                if (objectCall === 5) return Promise.resolve({ model: 'advanced', label: 'Advanced' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'advanced')).resolves.toEqual({ Status: 'Success', Model: 'Advanced' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('maps ChatGPT preference API auth rejection to AuthRequiredError', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: '__Secure-next-auth.session-token', value: 'cookie', domain: '.chatgpt.com' }]),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'advanced')).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('selects current Chinese intelligence options by exact visible menu text', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">GPT-5.5 均衡</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu">
              <div role="menuitemradio">极速</div>
              <div role="menuitemradio">均衡</div>
              <div role="menuitemradio">高级</div>
              <div role="menuitemradio">超高</div>
              <div role="menuitemradio">专业</div>
            </div>
        `);
        let clickCount = 0;
        page.wait = vi.fn().mockResolvedValue(undefined);
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                page.evaluate(`document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.5 超高'`);
            }
        });

        await expect(selectChatGPTModel(page, 'very-high')).resolves.toEqual({ Status: 'Success', Model: 'Very High' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('verifies selection from stable model test id when the current visible label is unknown', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Mode rapide</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu">
              <div role="menuitemradio">极速</div>
            </div>
        `);
        let clickCount = 0;
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                await page.evaluate(`
                    const button = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
                    button.innerHTML = '<span data-testid="model-switcher-gpt-5-5">Mode rapide</span>';
                `);
                for (const node of page.dom.window.document.querySelectorAll('[data-testid]')) {
                    node.getBoundingClientRect = () => ({ width: 120, height: 36 });
                    node.scrollIntoView = () => {};
                }
            }
        });

        await expect(selectChatGPTModel(page, 'instant')).resolves.toEqual({ Status: 'Success', Model: 'Fast' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('selects actual English intelligence options by visible menu text', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Instant</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu" data-testid="composer-intelligence-picker-content">
              <div role="group">
                <div role="menuitemradio">Instant</div>
                <div role="menuitemradio">Medium</div>
                <div role="menuitemradio">High</div>
                <div role="menuitemradio">Extra High</div>
                <div role="menuitemradio">Pro</div>
              </div>
            </div>
        `);
        let clickCount = 0;
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                page.evaluate(`document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'Extra High'`);
            }
        });

        await expect(selectChatGPTModel(page, 'extra-high')).resolves.toEqual({ Status: 'Success', Model: 'Very High' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('selects Instant when the current precise level is Medium', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Medium</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu" data-testid="composer-intelligence-picker-content">
              <div role="group">
                <div role="menuitemradio">Instant</div>
                <div role="menuitemradio">Medium</div>
                <div role="menuitemradio">High</div>
                <div role="menuitemradio">Extra High</div>
                <div role="menuitemradio">Pro</div>
              </div>
            </div>
        `);
        let clickCount = 0;
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                page.evaluate(`document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'Instant'`);
            }
        });

        await expect(selectChatGPTModel(page, 'instant')).resolves.toEqual({ Status: 'Success', Model: 'Fast' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('selects Balanced when the current precise level is Extra High', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Extra High</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu" data-testid="composer-intelligence-picker-content">
              <div role="group">
                <div role="menuitemradio">Instant</div>
                <div role="menuitemradio">Medium</div>
                <div role="menuitemradio">High</div>
                <div role="menuitemradio">Extra High</div>
                <div role="menuitemradio">Pro</div>
              </div>
            </div>
        `);
        let clickCount = 0;
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                page.evaluate(`document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'Medium'`);
            }
        });

        await expect(selectChatGPTModel(page, 'balanced')).resolves.toEqual({ Status: 'Success', Model: 'Balanced' });
        expect(page.nativeClick).toHaveBeenCalledTimes(2);
    });

    it('uses guarded intelligence menu order for unknown localized labels', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Mode rapide</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu" data-testid="composer-intelligence-picker-content">
              <div role="group">
                <div role="menuitemradio" aria-checked="false">L0</div>
                <div role="menuitemradio" aria-checked="false">L1</div>
                <div role="menuitemradio" aria-checked="false">L2</div>
                <div role="menuitemradio" aria-checked="false">L3</div>
                <div role="menuitemradio" aria-checked="false">L4</div>
              </div>
            </div>
        `);
        let clickCount = 0;
        page.nativeClick = vi.fn().mockImplementation(async () => {
            clickCount += 1;
            if (clickCount === 2) {
                const options = page.dom.window.document.querySelectorAll('[role="menuitemradio"]');
                for (const option of options) option.setAttribute('aria-checked', 'false');
                options[3].setAttribute('aria-checked', 'true');
            }
        });

        await expect(selectChatGPTModel(page, 'extra-high')).resolves.toEqual({ Status: 'Success', Model: 'Very High' });
        expect(page.nativeClick).toHaveBeenCalledTimes(4);
    });

    it('does not use order fallback outside the guarded five-option intelligence picker', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Mode rapide</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu">
              <div role="group">
                <div role="menuitemradio">L0</div>
                <div role="menuitemradio">L1</div>
                <div role="menuitemradio">L2</div>
                <div role="menuitemradio">L3</div>
                <div role="menuitemradio">L4</div>
              </div>
            </div>
        `);
        page.nativeClick = vi.fn().mockResolvedValue(undefined);

        await expect(selectChatGPTModel(page, 'extra-high')).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Could not click the ChatGPT Very High model option'),
        });
    });

    it('does not use order fallback when the intelligence picker does not expose exactly five options', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button" data-testid="model-switcher-dropdown-button">Mode rapide</button>
              <div id="prompt-textarea" contenteditable="true"></div>
            </form>
            <div role="menu" data-testid="composer-intelligence-picker-content">
              <div role="group">
                <div role="menuitemradio">L0</div>
                <div role="menuitemradio">L1</div>
                <div role="menuitemradio">L2</div>
                <div role="menuitemradio">L3</div>
              </div>
            </div>
        `);
        page.nativeClick = vi.fn().mockResolvedValue(undefined);

        await expect(selectChatGPTModel(page, 'very-high')).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Could not click the ChatGPT Very High model option'),
        });
    });

    it('fails closed when the postcondition does not prove the requested model', async () => {
        let objectCall = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve('https://chatgpt.com/c/demo');
                objectCall += 1;
                if (objectCall === 1) return Promise.resolve({ isLoggedIn: true, hasLoginGate: false, hasComposer: true });
                if (objectCall === 2) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                if (objectCall === 3) return Promise.resolve({ found: true, x: 10, y: 20 });
                if (objectCall === 4) return Promise.resolve({ found: true, x: 30, y: 40 });
                if (objectCall === 5) return Promise.resolve({ model: 'balanced', label: 'Balanced' });
                return Promise.resolve({});
            }),
        };

        await expect(selectChatGPTModel(page, 'fast')).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('did not switch to Fast'),
        });
    });
});

describe('chatgpt tool selection validation', () => {
    it('rejects unknown tool names', async () => {
        await expect(selectChatGPTTool({ nativeClick: vi.fn() }, 'unknown'))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(selectChatGPTTool({ nativeClick: vi.fn() }, 'unknown'))
            .rejects.toThrow('Unknown ChatGPT tool "unknown"');
    });

    it('requires native browser click support', async () => {
        await expect(selectChatGPTTool({}, 'deep-research'))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(selectChatGPTTool({}, 'deep-research'))
            .rejects.toThrow('ChatGPT tool selection requires native browser click support.');
    });
});

describe('chatgpt detail completion state', () => {
    function createDetailPageMock({ generating = false, messages = [] } = {}) {
        return {
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script.includes('Stop generating') || script.includes('Thinking')) {
                    return Promise.resolve(generating);
                }
                if (script.includes('data-message-author-role')) {
                    return Promise.resolve(messages.map((message) => ({
                        role: message.Role,
                        text: message.Text,
                        html: message.Html ?? message.Text,
                    })));
                }
                return Promise.resolve(undefined);
            }),
        };
    }

    it('adds generation state to detail rows', async () => {
        const page = createDetailPageMock({
            generating: true,
            messages: [
                { Role: 'User', Text: 'question' },
                { Role: 'Assistant', Text: 'working' },
            ],
        });

        await expect(getChatGPTDetailRows(page)).resolves.toMatchObject({
            generating: true,
            rows: [
                { Index: 1, Role: 'User', Text: 'question', Generating: true, StableSeconds: 0 },
                { Index: 2, Role: 'Assistant', Text: 'working', Generating: true, StableSeconds: 0 },
            ],
        });
    });

    it('waits until assistant output is stable', async () => {
        const page = createDetailPageMock({
            generating: false,
            messages: [
                { Role: 'User', Text: 'question' },
                { Role: 'Assistant', Text: 'done' },
            ],
        });

        const result = await waitForChatGPTDetailRows(page, { timeoutSeconds: 5, stableSeconds: 0 });

        expect(result.rows.at(-1)).toMatchObject({
            Role: 'Assistant',
            Text: 'done',
            Generating: false,
            StableSeconds: 0,
        });
    });
});

describe('chatgpt ask response extraction boundary', () => {
    function createResponseWaitPage(messageSets, { url = 'https://chatgpt.com/c/demo' } = {}) {
        let messageIndex = 0;
        return {
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script === 'window.location.href') return Promise.resolve(url);
                if (script.includes('Stop generating') || script.includes('Thinking')) {
                    return Promise.resolve(false);
                }
                if (script.includes('data-message-author-role')) {
                    const messages = messageSets[Math.min(messageIndex, messageSets.length - 1)] ?? [];
                    messageIndex += 1;
                    return Promise.resolve(messages.map((message) => ({
                        role: message.Role,
                        text: message.Text,
                        html: message.Text,
                    })));
                }
                return Promise.resolve(undefined);
            }),
        };
    }

    function mockAdvancingClock(stepMs = 1000) {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => {
            now += stepMs;
            return now;
        });
    }

    it('does not return a stale baseline assistant pair for repeated prompts', async () => {
        mockAdvancingClock();
        const baselineMessages = [
            { Role: 'User', Text: 'repeat this prompt' },
            { Role: 'Assistant', Text: 'old answer' },
        ];
        const page = createResponseWaitPage([
            baselineMessages,
            baselineMessages,
            baselineMessages,
        ]);

        await expect(waitForChatGPTResponse(page, baselineMessages.length, 'repeat this prompt', 4, {
            baselinePairCounts: getChatGPTResponsePairCounts(baselineMessages, 'repeat this prompt'),
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).rejects.toThrow(/chatgpt ask timed out/);
    });

    it('requires an exact normalized user prompt match instead of substring matching', async () => {
        mockAdvancingClock();
        const staleMessages = [
            { Role: 'User', Text: 'write a short story' },
            { Role: 'Assistant', Text: 'old answer' },
        ];
        const page = createResponseWaitPage([
            staleMessages,
            staleMessages,
            staleMessages,
        ]);

        await expect(waitForChatGPTResponse(page, 0, 'short', 4, {
            baselinePairKeys: new Set(),
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).rejects.toThrow(/chatgpt ask timed out/);
    });

    it('does not collapse punctuation-distinct prompts into the requested prompt', async () => {
        mockAdvancingClock();
        const staleMessages = [
            { Role: 'User', Text: 'what now?' },
            { Role: 'Assistant', Text: 'old answer' },
        ];
        const page = createResponseWaitPage([
            staleMessages,
            staleMessages,
            staleMessages,
        ]);

        await expect(waitForChatGPTResponse(page, 0, 'what now!', 4, {
            baselinePairCounts: getChatGPTResponsePairCounts([], 'what now!'),
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).rejects.toThrow(/chatgpt ask timed out/);
    });

    it('returns a stable assistant response for the new prompt pair', async () => {
        mockAdvancingClock();
        const baselineMessages = [
            { Role: 'User', Text: 'repeat this prompt' },
            { Role: 'Assistant', Text: 'old answer' },
        ];
        const newMessages = [
            ...baselineMessages,
            { Role: 'User', Text: 'repeat this prompt' },
            { Role: 'Assistant', Text: 'new answer' },
        ];
        const page = createResponseWaitPage([
            newMessages,
            newMessages,
            newMessages,
        ]);

        await expect(waitForChatGPTResponse(page, baselineMessages.length, 'repeat this prompt', 10, {
            baselinePairCounts: getChatGPTResponsePairCounts(baselineMessages, 'repeat this prompt'),
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).resolves.toBe('new answer');
    });

    it('accepts a repeated prompt when the new response text matches a visible baseline answer', async () => {
        mockAdvancingClock();
        const baselineMessages = [
            { Role: 'User', Text: 'repeat this prompt' },
            { Role: 'Assistant', Text: 'same answer' },
        ];
        const newMessages = [
            ...baselineMessages,
            { Role: 'User', Text: 'repeat this prompt' },
            { Role: 'Assistant', Text: 'same answer' },
        ];
        const page = createResponseWaitPage([
            newMessages,
            newMessages,
            newMessages,
        ]);

        await expect(waitForChatGPTResponse(page, baselineMessages.length, 'repeat this prompt', 10, {
            baselinePairCounts: getChatGPTResponsePairCounts(baselineMessages, 'repeat this prompt'),
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).resolves.toBe('same answer');
    });

    it('fails closed when the browser drifts to another conversation while waiting', async () => {
        mockAdvancingClock();
        const page = createResponseWaitPage([], { url: 'https://chatgpt.com/c/other' });

        await expect(waitForChatGPTResponse(page, 0, 'hello', 4, {
            conversationUrl: 'https://chatgpt.com/c/demo',
        })).rejects.toThrow(/navigated away from the target conversation/);
    });
});

describe('chatgpt generation state', () => {
    it('detects zh-CN thinking status text', async () => {
        const page = {
            evaluate: vi.fn((script) => {
                expect(script).toContain('正在思考');
                return Promise.resolve(true);
            }),
        };

        await expect(isGenerating(page)).resolves.toBe(true);
    });
});

describe('chatgpt current model detection', () => {
    it.each([
        ['Instant', { model: 'fast', label: 'Fast' }],
        ['Medium', { model: 'balanced', label: 'Balanced' }],
        ['Thinking', { model: 'advanced', label: 'Advanced' }],
        ['High', { model: 'advanced', label: 'Advanced' }],
        ['Extra High', { model: 'very-high', label: 'Very High' }],
        ['Pro', { model: 'pro', label: 'Pro' }],
        ['GPT-5.5 极速', { model: 'fast', label: 'Fast' }],
        ['GPT-5.5 均衡', { model: 'balanced', label: 'Balanced' }],
        ['智能水平 高级', { model: 'advanced', label: 'Advanced' }],
        ['GPT-5.5 超高', { model: 'very-high', label: 'Very High' }],
        ['GPT-5.5 专业', { model: 'pro', label: 'Pro' }],
        ['进阶专业', { model: 'pro', label: 'Pro' }],
    ])('detects the visible %s model label', async (label, expected) => {
        const page = createDomEvaluatePage(`<form><button>${label}</button></form>`);

        await expect(getCurrentChatGPTModel(page)).resolves.toEqual(expected);
    });

    it('uses model-specific test ids before visible text labels', async () => {
        const page = createDomEvaluatePage(`
            <form>
              <button type="button">
                <span data-testid="model-switcher-gpt-5-5-pro">Niveau inconnu</span>
              </button>
            </form>
        `);

        await expect(getCurrentChatGPTModel(page)).resolves.toEqual({ model: 'pro', label: 'Pro' });
    });

    it('returns null fields when the model selector is missing', async () => {
        const page = createDomEvaluatePage('<form><button>Send</button></form>');

        await expect(getCurrentChatGPTModel(page)).resolves.toEqual({
            model: null,
            label: null,
        });
    });
});

describe('chatgpt current tool detection', () => {
    it.each([
        ['深度研究', { tool: 'deep-research', label: 'Deep Research' }],
        ['Deep Research', { tool: 'deep-research', label: 'Deep Research' }],
        ['网页搜索', { tool: 'web-search', label: 'Web Search' }],
        ['搜索', { tool: 'web-search', label: 'Web Search' }],
        ['Web Search', { tool: 'web-search', label: 'Web Search' }],
    ])('detects the visible %s tool label', async (label, expected) => {
        const page = createDomEvaluatePage(`<form><button>${label}</button></form>`);

        await expect(getCurrentChatGPTTool(page)).resolves.toEqual(expected);
    });

    it('returns null fields when no supported tool is selected', async () => {
        const page = createDomEvaluatePage('<form><button>添加文件</button></form>');

        await expect(getCurrentChatGPTTool(page)).resolves.toEqual({
            tool: null,
            label: null,
        });
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
            nativeClick: vi.fn().mockResolvedValue(undefined),
            nativeType: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script.includes('findComposer')) return Promise.resolve({ ready: true, x: 12, y: 34 });
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
        expect(page.nativeClick).toHaveBeenCalledWith(12, 34);
    });

    it('uses the composer submit fallback consistently for readiness and click', async () => {
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            nativeType: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                if (script.includes('findComposer')) return Promise.resolve({ ready: true, x: 12, y: 34 });
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
        expect(__test__.SEND_BUTTON_LABELS).toEqual(expect.arrayContaining(['Send prompt', 'Send message', 'Send', '发送', '发送消息', '发送提示']));
        expect(__test__.CLOSE_SIDEBAR_LABELS).toEqual(expect.arrayContaining(['Close sidebar', '关闭边栏']));
    });
});

describe('chatgpt generated image detection', () => {
    function createDomPage(html, setup = () => { }) {
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

describe('chatgpt project id parsing', () => {
    it('accepts project hex ids and /g/g-p- URLs', () => {
        expect(__test__.parseChatGPTProjectId('12345678abcdef90')).toBe('12345678abcdef90');
        expect(__test__.parseChatGPTProjectId('https://chatgpt.com/g/g-p-12345678abcdef90')).toBe('12345678abcdef90');
        expect(__test__.parseChatGPTProjectId('/g/g-p-abcdef0123456789')).toBe('abcdef0123456789');
    });

    it('accepts g-p-{hex_id}-{slug} pattern', () => {
        expect(__test__.parseChatGPTProjectId('g-p-12345678-my-project')).toBe('12345678');
    });

    it('rejects invalid project ids', () => {
        expect(() => __test__.parseChatGPTProjectId('')).toThrow(/project/);
        expect(() => __test__.parseChatGPTProjectId('https://chatgpt.com/')).toThrow(/project/);
        expect(() => __test__.parseChatGPTProjectId('https://evil.test/g/g-p-12345678')).toThrow(/project/);
        expect(() => __test__.parseChatGPTProjectId('http://chatgpt.com/g/g-p-12345678')).toThrow(/project/);
        expect(() => __test__.parseChatGPTProjectId('g-p-a-short')).toThrow(/project/);
        expect(() => __test__.parseChatGPTProjectId('https://chatgpt.com/g/g-p-a-short')).toThrow(/project/);
    });
});

describe('chatgpt project navigation', () => {
    it('verifies the current URL stays bound to the requested project', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                url: 'https://chatgpt.com/g/g-p-deadbeef',
                title: 'Other Project',
                hasComposer: true,
                isLoggedIn: true,
                hasLoginGate: false,
            }),
        };

        await expect(navigateToProject(page, '12345678')).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps project login redirects to AuthRequiredError', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                url: 'https://chatgpt.com/auth/login',
                title: 'Log in',
                hasComposer: false,
                isLoggedIn: false,
                hasLoginGate: true,
            }),
        };

        await expect(navigateToProject(page, '12345678')).rejects.toBeInstanceOf(AuthRequiredError);
    });
});

describe('chatgpt file path validation', () => {
    it('validates local files for project upload (any type)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const pdfPath = path.join(dir, 'report.pdf');
        fs.writeFileSync(pdfPath, 'fake-pdf');
        const docxPath = path.join(dir, 'notes.docx');
        fs.writeFileSync(docxPath, 'fake-docx');

        const { prepareChatGPTFilePaths } = await import('./utils.js');
        await expect(prepareChatGPTFilePaths([pdfPath])).resolves.toEqual({ ok: true, paths: [pdfPath] });
        await expect(prepareChatGPTFilePaths([pdfPath, docxPath])).resolves.toEqual({ ok: true, paths: [pdfPath, docxPath] });
        await expect(prepareChatGPTFilePaths([path.join(dir, 'missing.txt')])).resolves.toMatchObject({
            ok: false,
            reason: expect.stringContaining('File not found'),
        });
    });
});

describe('chatgpt project file upload helper', () => {
    it('exposes mimeFromFilePath for fallback upload', () => {
        expect(__test__.mimeFromFilePath('/tmp/report.pdf')).toBe('application/pdf');
        expect(__test__.mimeFromFilePath('/tmp/notes.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(__test__.mimeFromFilePath('/tmp/data.csv')).toBe('text/csv');
        expect(__test__.mimeFromFilePath('/tmp/code.py')).toBe('text/x-python');
        expect(__test__.mimeFromFilePath('/tmp/image.png')).toBe('image/png');
        expect(__test__.mimeFromFilePath('/tmp/unknown.xyz')).toBe('application/octet-stream');
    });

    it('exposes PROJECT_LINK_SELECTOR for project link extraction', () => {
        expect(__test__.PROJECT_LINK_SELECTOR).toBe('a[href*="/g/g-p-"]');
    });

    it('extracts visible project anchors from the sidebar without React Fiber internals', async () => {
        const dom = new JSDOM(`
            <!doctype html>
            <a data-sidebar-item="true" href="/g/g-p-12345678-alpha">
              <span data-testid="project-folder-icon"></span>
              Project Alpha
            </a>
            <a data-sidebar-item="true" href="https://chatgpt.com/g/g-p-12345678-alpha?model=gpt-5">
              <span data-testid="project-folder-icon"></span>
              Duplicate Alpha
            </a>
            <a data-sidebar-item="true" href="/g/g-p-abcdef90">
              <span data-testid="project-folder-icon"></span>
              Project Beta
            </a>
            <a data-sidebar-item="true" href="https://evil.test/g/g-p-badbadbad">
              <span data-testid="project-folder-icon"></span>
              Evil Project
            </a>
            <a data-sidebar-item="true" href="/g/g-p-a-short">
              <span data-testid="project-folder-icon"></span>
              Short Bait
            </a>
        `, {
            url: 'https://chatgpt.com/',
            runScripts: 'outside-only',
        });
        for (const el of dom.window.document.querySelectorAll('[data-sidebar-item="true"]')) {
            el.getBoundingClientRect = () => ({ width: 240, height: 32 });
        }

        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(String(script)))),
        };

        const { getProjectList } = await import('./utils.js');
        await expect(getProjectList(page)).resolves.toEqual([
            {
                Index: 1,
                Id: '12345678',
                Title: 'Project Alpha',
                Url: 'https://chatgpt.com/g/g-p-12345678-alpha',
            },
            {
                Index: 2,
                Id: 'abcdef90',
                Title: 'Project Beta',
                Url: 'https://chatgpt.com/g/g-p-abcdef90',
            },
        ]);
    });

    it('opens project knowledge dialog by finding an "Add files" button', async () => {
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            setFileInput: vi.fn(),
            evaluate: vi.fn((script) => {
                if (String(script).includes('Add files')) {
                    return Promise.resolve(true);
                }
                if (String(script).includes('role="dialog"')) {
                    return Promise.resolve(true);
                }
                return Promise.resolve(undefined);
            }),
        };

        const { openProjectKnowledgeDialog } = await import('./utils.js');
        const result = await openProjectKnowledgeDialog(page);
        expect(result).toBe(true);
    });

    it('reports failure when no Add files button is found', async () => {
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            setFileInput: vi.fn(),
            evaluate: vi.fn().mockResolvedValue(false),
        };

        const { openProjectKnowledgeDialog } = await import('./utils.js');
        const result = await openProjectKnowledgeDialog(page);
        expect(result).toBe(false);
    });

    it('opens the live project Sources tab upload surface when no Add files dialog exists', async () => {
        const dom = new JSDOM(`
            <!doctype html>
            <button role="tab" aria-selected="true">Chats</button>
            <button role="tab" aria-selected="false" id="project-home-tabs-demo-sources">Sources</button>
            <div role="tabpanel" data-state="inactive"></div>
        `, {
            url: 'https://chatgpt.com/g/g-p-12345678-demo/project',
            runScripts: 'outside-only',
        });
        const sourcesTab = dom.window.document.querySelector('#project-home-tabs-demo-sources');
        sourcesTab.getBoundingClientRect = () => ({ width: 96, height: 32 });
        sourcesTab.addEventListener('click', () => {
            sourcesTab.setAttribute('aria-selected', 'true');
            sourcesTab.dataset.clicked = 'true';
        });

        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(String(script)))),
        };

        const { openProjectKnowledgeDialog } = await import('./utils.js');
        await expect(openProjectKnowledgeDialog(page)).resolves.toBe(true);
        expect(sourcesTab.dataset.clicked).toBe('true');
    });

    it('projects file upload uses dialog file input selectors and waits for filename confirmation', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'report.pdf');
        fs.writeFileSync(filePath, 'fake-pdf');

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeType: vi.fn(),
            setFileInput: vi.fn().mockRejectedValue(new Error('No element found')),
            evaluate: vi.fn((script) => {
                const s = String(script);
                // getPageState returns a specific object
                if (s.includes('isVisible') && s.includes('hasComposer') && s.includes('isLoggedIn')) {
                    return Promise.resolve({ session: 'test', data: { url: 'https://chatgpt.com/g/g-p-12345678', title: 'Project', hasComposer: true, isLoggedIn: true, hasLoginGate: false } });
                }
                if (s.includes('expectedFileNames')) {
                    return Promise.resolve({ ok: true });
                }
                if (s.includes('new DataTransfer()')) {
                    return Promise.resolve({ ok: true });
                }
                if (s.includes('Add files')) return Promise.resolve(true);
                if (s.includes('role="dialog"')) return Promise.resolve(true);
                return Promise.resolve(undefined);
            }),
        };

        const { uploadChatGPTProjectFiles } = await import('./utils.js');
        const result = await uploadChatGPTProjectFiles(page, '12345678', [filePath]);

        expect(result).toEqual({ ok: true, files: [filePath] });
        expect(page.goto).toHaveBeenCalledWith(
            expect.stringContaining('/g/g-p-12345678'),
            expect.any(Object),
        );
        expect(page.evaluate.mock.calls.some(([script]) => String(script).includes('expectedFileNames'))).toBe(true);
    });

    it('returns failure when project upload confirmation does not appear', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'missing-confirmation.pdf');
        fs.writeFileSync(filePath, 'fake-pdf');

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            setFileInput: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                const s = String(script);
                if (s.includes('isVisible') && s.includes('hasComposer') && s.includes('isLoggedIn')) {
                    return Promise.resolve({ session: 'test', data: { url: 'https://chatgpt.com/g/g-p-12345678', title: 'Project', hasComposer: true, isLoggedIn: true, hasLoginGate: false } });
                }
                if (s.includes('expectedFileNames')) return Promise.resolve({ ok: false, reason: 'uploaded file did not appear in project knowledge' });
                if (s.includes('Add files')) return Promise.resolve(true);
                if (s.includes('role="dialog"')) return Promise.resolve(true);
                return Promise.resolve(undefined);
            }),
        };

        const { uploadChatGPTProjectFiles } = await import('./utils.js');
        const result = await uploadChatGPTProjectFiles(page, '12345678', [filePath]);

        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('uploaded file did not appear'),
        });
    });

    it('does not treat composer/body filename text as project knowledge confirmation', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'composer-only.pdf');
        fs.writeFileSync(filePath, 'fake-pdf');

        const dom = new JSDOM(`
            <!doctype html>
            <main>
              <form data-type="unified-composer">
                <input id="upload-files" type="file">
                <span>composer-only.pdf</span>
              </form>
            </main>
        `, {
            url: 'https://chatgpt.com/g/g-p-12345678',
            runScripts: 'outside-only',
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            setFileInput: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn((script) => {
                const s = String(script);
                if (s.includes('isVisible') && s.includes('hasComposer') && s.includes('isLoggedIn')) {
                    return Promise.resolve({ session: 'test', data: { url: 'https://chatgpt.com/g/g-p-12345678', title: 'Project', hasComposer: true, isLoggedIn: true, hasLoginGate: false } });
                }
                if (s.includes('expectedFileNames')) {
                    return Promise.resolve(dom.window.eval(s));
                }
                if (s.includes('Add files')) return Promise.resolve(true);
                if (s.includes('role="dialog"')) return Promise.resolve(true);
                return Promise.resolve(undefined);
            }),
        };

        const { uploadChatGPTProjectFiles } = await import('./utils.js');
        const result = await uploadChatGPTProjectFiles(page, '12345678', [filePath]);

        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('project knowledge surface'),
        });
    });
});
