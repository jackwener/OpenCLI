import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { JSDOM } from 'jsdom';
import { __test__, isLoggedIn, isOnGrok, normalizeBooleanFlag, parseGrokSessionId, sendMessage, waitForAnswer } from './utils.js';

describe('grok parseGrokSessionId', () => {
    const id = '7c4197f2-10a1-4ebb-a84a-fea89f4f1d06';

    it('returns a bare UUID unchanged', () => {
        expect(parseGrokSessionId(id)).toBe(id);
    });

    it('lowercases an upper-case ID', () => {
        expect(parseGrokSessionId(id.toUpperCase())).toBe(id);
    });

    it('extracts the session ID from a full grok.com chat URL', () => {
        expect(parseGrokSessionId(`https://grok.com/c/${id}`)).toBe(id);
        expect(parseGrokSessionId(`https://grok.com/c/${id}/`)).toBe(id);
        expect(parseGrokSessionId(`https://grok.com/c/${id}?rid=abc`)).toBe(id);
        expect(parseGrokSessionId(`https://x.grok.com/c/${id}`)).toBe(id);
    });

    it('throws ArgumentError on empty input', () => {
        expect(() => parseGrokSessionId('')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(null)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(undefined)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId('   ')).toThrow(ArgumentError);
    });

    it('throws ArgumentError on non-UUID input', () => {
        expect(() => parseGrokSessionId('not-an-id')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId('123')).toThrow(ArgumentError);
        // 32 hex chars (no dashes) — not the Grok UUID shape
        expect(() => parseGrokSessionId('7c4197f210a14ebba84afea89f4f1d06')).toThrow(ArgumentError);
        // UUID-shaped but bad hex
        expect(() => parseGrokSessionId('zc4197f2-10a1-4ebb-a84a-fea89f4f1d06')).toThrow(ArgumentError);
        // Bare-ID mode must not accept URL/query suffixes.
        expect(() => parseGrokSessionId(`${id}?next=abc`)).toThrow(ArgumentError);
        // URL with the wrong path shape must not silently fall through.
        expect(() => parseGrokSessionId('https://grok.com/somewhere/else')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`http://grok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://evil.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://fakegrok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com.evil.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://evil.com/?next=https://grok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}/extra`)).toThrow(ArgumentError);
        // URL embedding extra hex tail after the UUID must not silently truncate
        // and open the wrong conversation.
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}0`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}-extra`)).toThrow(ArgumentError);
    });
});

describe('grok isOnGrok', () => {
    const fakePage = (url) => ({
        evaluate: () => url instanceof Error ? Promise.reject(url) : Promise.resolve(url),
    });

    it('returns true for grok.com URLs', async () => {
        expect(await isOnGrok(fakePage('https://grok.com/'))).toBe(true);
        expect(await isOnGrok(fakePage('https://grok.com/c/abc'))).toBe(true);
    });

    it('returns true for grok.com subdomains', async () => {
        expect(await isOnGrok(fakePage('https://api.grok.com/v1'))).toBe(true);
    });

    it('returns false for non-grok domains and rejects substring matches', async () => {
        expect(await isOnGrok(fakePage('https://fakegrok.com/'))).toBe(false);
        expect(await isOnGrok(fakePage('https://example.com/?next=grok.com'))).toBe(false);
        expect(await isOnGrok(fakePage('about:blank'))).toBe(false);
    });

    it('returns false when evaluate throws (detached tab)', async () => {
        expect(await isOnGrok(fakePage(new Error('detached')))).toBe(false);
    });
});

describe('grok normalizeBooleanFlag', () => {
    it('passes through actual booleans', () => {
        expect(normalizeBooleanFlag(true)).toBe(true);
        expect(normalizeBooleanFlag(false)).toBe(false);
    });

    it('returns the fallback for null/empty input', () => {
        expect(normalizeBooleanFlag(null)).toBe(false);
        expect(normalizeBooleanFlag(undefined)).toBe(false);
        expect(normalizeBooleanFlag('')).toBe(false);
        expect(normalizeBooleanFlag(null, true)).toBe(true);
    });

    it('parses common truthy strings', () => {
        for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' Yes ']) {
            expect(normalizeBooleanFlag(v)).toBe(true);
        }
    });

    it('treats anything else as falsy', () => {
        for (const v of ['no', 'off', '0', 'false', 'random']) {
            expect(normalizeBooleanFlag(v)).toBe(false);
        }
    });
});

describe('grok getPinStateFromMenuLabels', () => {
    it('detects pinned state from unpin labels without substring collisions', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Unpin', 'Delete'])).toBe('pinned');
        expect(__test__.getPinStateFromMenuLabels(['打开新标签页', '取消置顶', '删除'])).toBe('pinned');
    });

    it('detects unpinned state from pin labels', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Pin', 'Delete'])).toBe('unpinned');
        expect(__test__.getPinStateFromMenuLabels(['打开新标签页', '置顶', '删除'])).toBe('unpinned');
    });

    it('returns empty string when neither state label is visible', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Delete'])).toBe('');
        expect(__test__.getPinStateFromMenuLabels([])).toBe('');
    });
});

describe('grok isLoggedIn', () => {
    function createPage(states) {
        const queue = [...states];
        return {
            evaluate: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0])),
            wait: vi.fn(async () => undefined),
        };
    }

    it('returns true immediately when the composer is already visible', async () => {
        const page = createPage(['in']);
        await expect(isLoggedIn(page)).resolves.toBe(true);
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('keeps polling while the composer has not painted yet', async () => {
        const page = createPage(['pending', 'pending', 'pending', 'in']);
        await expect(isLoggedIn(page)).resolves.toBe(true);
        expect(page.evaluate).toHaveBeenCalledTimes(4);
        expect(page.wait).toHaveBeenCalledTimes(3);
    });

    it('returns false right away when a sign-in button is visible', async () => {
        const page = createPage(['out']);
        await expect(isLoggedIn(page)).resolves.toBe(false);
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('gives up after the poll window when the composer never appears', async () => {
        const page = createPage(['pending']);
        await expect(isLoggedIn(page, 3)).resolves.toBe(false);
        expect(page.evaluate).toHaveBeenCalledTimes(4);
        expect(page.wait).toHaveBeenCalledTimes(3);
    });

    it('detects the composer and the sign-in button in the page probe', async () => {
        const { JSDOM } = await import('jsdom');
        const probe = async (html) => {
            const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only' });
            Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
                configurable: true,
                value: () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }),
            });
            const page = { evaluate: async (script) => window.eval(script), wait: vi.fn(async () => undefined) };
            return isLoggedIn(page, 0);
        };
        expect(await probe('<div class="ProseMirror" contenteditable="true"></div>')).toBe(true);
        expect(await probe('<div class="ProseMirror" contenteditable="true"></div><button>Sign in</button>')).toBe(false);
        expect(await probe('<p>loading</p>')).toBe(false);
    });
});

describe('grok sendMessage', () => {
    it('requires a submitted user turn after both submit-button and Enter fallback paths', async () => {
        let script = '';
        const page = {
            evaluate: async (value) => {
                script = String(value);
                return { ok: false, reason: 'test-capture' };
            },
        };

        await sendMessage(page, 'hello from test');

        expect(script).toContain('waitForSubmittedUserTurn');
        expect(script).toContain('Grok submit button was clicked but no new user turn appeared.');
        expect(script).toContain('Grok Enter-key fallback fired but no new user turn appeared.');
        expect(script).toContain('[data-testid="user-message"]');
        expect(script).toContain("submittedVia: 'submit-button'");
        expect(script).toContain("submittedVia: 'enter-key'");
    });
});

describe('grok sendMessage with a formatted prompt', () => {
    async function submitPrompt(prompt, renderedUserText) {
        const dom = new JSDOM(
            '<!doctype html><body><div id="response-old"><div data-testid="user-message">earlier question</div></div>'
            + '<div class="ProseMirror" contenteditable="true"></div>'
            + '<button data-testid="chat-submit">Submit</button></body>',
            { runScripts: 'outside-only' },
        );
        const { window } = dom;
        window.setTimeout = (callback) => { callback(); return 0; };
        Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }),
        });
        const noop = () => true;
        window.document.querySelector('.ProseMirror').editor = {
            commands: { focus: noop, clearContent: noop, insertContent: noop },
        };
        // Grok shows the markdown-rendered prompt: fences lose their backticks.
        window.document.querySelector('button').addEventListener('click', () => {
            const turn = window.document.createElement('div');
            turn.setAttribute('data-testid', 'user-message');
            turn.textContent = renderedUserText;
            window.document.body.append(turn);
        });
        const page = { evaluate: async (script) => window.eval(script) };
        return sendMessage(page, prompt);
    }

    it('accepts the rendered bubble of a prompt that contains a code fence', async () => {
        const prompt = 'Revisa esta funcion Python que reparte el alquiler.\n\n```python\ndef repartir(x):\n    return x\n```\nSe conciso.';
        const rendered = 'Revisa esta funcion Python que reparte el alquiler.\n\npython\ndef repartir(x):\n    return x\nSe conciso.';
        await expect(submitPrompt(prompt, rendered)).resolves.toEqual({ ok: true, submittedVia: 'submit-button' });
    });

    it('rejects a different prompt sharing the first forty characters', async () => {
        const prefix = 'Please carefully review this lengthy implementation: ';
        await expect(submitPrompt(prefix + 'correct code', prefix + 'different code')).resolves.toMatchObject({ ok: false });
    });

    it('does not treat an empty normalized prompt as matching any turn', async () => {
        await expect(submitPrompt('```', 'unrelated message')).resolves.toMatchObject({ ok: false });
    });

    it('accepts the rendered bubble of a prompt that starts with a code fence', async () => {
        const prompt = '```python\ndef repartir(x):\n    return x\n```\nRevisa esta funcion.';
        const rendered = 'python\ndef repartir(x):\n    return x\nRevisa esta funcion.';
        await expect(submitPrompt(prompt, rendered)).resolves.toEqual({ ok: true, submittedVia: 'submit-button' });
    });
});

describe('grok waitForAnswer', () => {
    function createPage(steps) {
        // Each step is one poll: the assistant bubble text and whether the action bar has buttons.
        let index = 0;
        return {
            wait: vi.fn(async () => undefined),
            evaluate: vi.fn(async (script) => {
                const step = steps[Math.min(index, steps.length - 1)];
                if (String(script).includes('.action-buttons')) {
                    const generating = step.generating;
                    index += 1;
                    return generating;
                }
                return [{ id: 'abc-assistant', role: 'Assistant', text: step.text, html: '' }];
            }),
        };
    }

    it('keeps waiting while the response is still generating, even if the text is stable', async () => {
        const page = createPage([
            { text: 'Analizando la funcion Worked for 18s', generating: true },
            { text: 'Analizando la funcion Worked for 18s', generating: true },
            { text: 'Analizando la funcion Worked for 18s', generating: true },
            { text: 'Fallos reales: 1. recibos=[]', generating: false },
            { text: 'Fallos reales: 1. recibos=[]', generating: false },
            { text: 'Fallos reales: 1. recibos=[]', generating: false },
        ]);
        const now = vi.spyOn(Date, 'now');
        let clock = 0;
        now.mockImplementation(() => (clock += 3_000));
        const result = await waitForAnswer(page, 'prompt', 60, '');
        now.mockRestore();
        expect(result.status).toBe('ok');
        expect(result.assistant.text).toBe('Fallos reales: 1. recibos=[]');
    });
});
