import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__, collectGeminiTranscriptAdditions, getGeminiConversationList, getGeminiPageState, getGeminiVisibleTurns, pickGeminiDeepResearchExportUrl, readGeminiSnapshot, sanitizeGeminiResponseText, selectGeminiModel, selectGeminiThinking, sendGeminiMessage, } from './utils.js';
function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({}),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    };
}
describe('sanitizeGeminiResponseText', () => {
    it('strips a prompt echo only when it appears as a prefixed block', () => {
        const prompt = 'Reply with the word opencli';
        const value = `Reply with the word opencli\n\nopencli`;
        expect(sanitizeGeminiResponseText(value, prompt)).toBe('opencli');
    });
    it('does not strip prompt text that appears later in a legitimate answer', () => {
        const prompt = 'opencli';
        const value = 'You asked about opencli, and opencli is the right keyword here.';
        expect(sanitizeGeminiResponseText(value, prompt)).toBe(value);
    });
    it('removes known Gemini footer noise', () => {
        const value = 'Answer body\nGemini can make mistakes.\nGoogle Terms';
        expect(sanitizeGeminiResponseText(value, '')).toBe('Answer body');
    });
});
describe('collectGeminiTranscriptAdditions', () => {
    it('joins multiple new transcript lines instead of keeping only the last line', () => {
        const before = ['Older answer'];
        const current = ['Older answer', 'First new line', 'Second new line'];
        expect(collectGeminiTranscriptAdditions(before, current, '')).toBe('First new line\nSecond new line');
    });
    it('filters prompt echoes out of transcript additions', () => {
        const prompt = 'Tell me a haiku';
        const before = ['Previous'];
        const current = ['Previous', 'Tell me a haiku', 'Tell me a haiku\n\nSoft spring rain arrives'];
        expect(collectGeminiTranscriptAdditions(before, current, prompt)).toBe('Soft spring rain arrives');
    });
    it('keeps a reply line that quotes the prompt inside the answer body', () => {
        const prompt = '请只回复：OK';
        const before = ['baseline'];
        const current = ['baseline', '关于“请只回复：OK”，这里是解释。'];
        expect(collectGeminiTranscriptAdditions(before, current, prompt)).toBe('关于“请只回复：OK”，这里是解释。');
    });
});
describe('gemini send strategy', () => {
    it('includes structural composer selectors instead of relying only on english aria labels', () => {
        expect(__test__.GEMINI_COMPOSER_SELECTORS).toContain('.ql-editor[contenteditable="true"]');
        expect(__test__.GEMINI_COMPOSER_SELECTORS).toContain('.ql-editor[role="textbox"]');
    });
    it('prefers native text insertion before submitting the composer', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeType = vi.mocked(page.nativeType);
        const nativeKeyPress = vi.mocked(page.nativeKeyPress);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true })
            .mockResolvedValueOnce('button');
        const result = await sendGeminiMessage(page, '你好');
        expect(nativeType).toHaveBeenCalledWith('你好');
        expect(nativeKeyPress).not.toHaveBeenCalled();
        expect(result).toBe('button');
    });
    it('falls back when native insertion does not update the composer', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeType = vi.mocked(page.nativeType);
        const nativeKeyPress = vi.mocked(page.nativeKeyPress);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: false })
            .mockResolvedValueOnce({ hasText: true })
            .mockResolvedValueOnce('enter');
        const result = await sendGeminiMessage(page, '你好');
        expect(nativeType).toHaveBeenCalledWith('你好');
        expect(nativeKeyPress).toHaveBeenCalledWith('Enter');
        expect(evaluate).toHaveBeenCalledTimes(5);
        expect(result).toBe('enter');
    });
    it('falls back when native insertion throws', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeType = vi.mocked(page.nativeType);
        nativeType.mockRejectedValueOnce(new Error('Unknown action: cdp'));
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true })
            .mockResolvedValueOnce('button');
        const result = await sendGeminiMessage(page, '你好');
        expect(nativeType).toHaveBeenCalledWith('你好');
        expect(result).toBe('button');
    });
    it('retries composer preparation until a slow-loading composer appears', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const wait = vi.mocked(page.wait);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ ok: false, reason: 'Could not find Gemini composer' })
            .mockResolvedValueOnce({ ok: false, reason: 'Could not find Gemini composer' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true })
            .mockResolvedValueOnce('button');
        const result = await sendGeminiMessage(page, '你好');
        expect(result).toBe('button');
        expect(wait.mock.calls.filter(([value]) => value === 1)).toHaveLength(3);
    });
    it('keeps retrying until a composer that appears on the fourth attempt is ready', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const wait = vi.mocked(page.wait);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ ok: false, reason: 'Could not find Gemini composer' })
            .mockResolvedValueOnce({ ok: false, reason: 'Could not find Gemini composer' })
            .mockResolvedValueOnce({ ok: false, reason: 'Could not find Gemini composer' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true })
            .mockResolvedValueOnce('button');
        const result = await sendGeminiMessage(page, '你好');
        expect(result).toBe('button');
        expect(wait.mock.calls.filter(([value]) => value === 1)).toHaveLength(4);
    });
    it('avoids innerHTML in the fallback insertion path for trusted types pages', () => {
        expect(__test__.insertComposerTextFallbackScript('你好')).not.toContain('innerHTML');
        expect(__test__.insertComposerTextFallbackScript('你好')).toContain('replaceChildren');
    });
    it('keeps a button submit path in the generated submit script', () => {
        expect(__test__.submitComposerScript()).toContain('.click()');
    });
    it('matches the Traditional Chinese send label in the generated submit script', () => {
        expect(__test__.submitComposerScript()).toContain('傳送');
    });
    it('supports localized new chat labels in the generated new-chat script', () => {
        expect(__test__.clickNewChatScript()).toContain('发起新对话');
    });
});
describe('gemini turn normalization', () => {
    it('collapses only adjacent duplicate turns so identical replies across rounds remain visible', () => {
        const turns = [
            { Role: 'User', Text: '你说\n\n请只回复：OK' },
            { Role: 'User', Text: '请只回复：OK' },
            { Role: 'Assistant', Text: 'OK' },
            { Role: 'Assistant', Text: 'OK' },
            { Role: 'User', Text: '你说\n\n请只回复：OK' },
            { Role: 'User', Text: '请只回复：OK' },
            { Role: 'Assistant', Text: 'OK' },
            { Role: 'Assistant', Text: 'OK' },
        ];
        expect(__test__.collapseAdjacentGeminiTurns(turns)).toEqual([
            { Role: 'User', Text: '你说\n\n请只回复：OK' },
            { Role: 'User', Text: '请只回复：OK' },
            { Role: 'Assistant', Text: 'OK' },
            { Role: 'User', Text: '你说\n\n请只回复：OK' },
            { Role: 'User', Text: '请只回复：OK' },
            { Role: 'Assistant', Text: 'OK' },
        ]);
    });
});
describe('gemini evaluate result boundaries', () => {
    function runExpandRecentScript(buttonHtml) {
        const dom = new JSDOM(`<!doctype html><body>${buttonHtml}</body>`, {
            pretendToBeVisual: true,
            runScripts: 'outside-only',
        });
        const { window } = dom;
        Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ width: 100, height: 24, top: 0, left: 0, right: 100, bottom: 24 }),
        });
        let clicks = 0;
        window.document.querySelector('button')?.addEventListener('click', () => {
            clicks += 1;
        });
        const changed = window.eval(__test__.expandGeminiRecentScript());
        return { changed, clicks };
    }
    it('does not collapse already-expanded Recents when aria-expanded is missing', () => {
        expect(runExpandRecentScript('<button aria-label="Collapse Recents">Recents</button>')).toEqual({
            changed: false,
            clicks: 0,
        });
        expect(runExpandRecentScript('<button aria-label="收起最近">最近</button>')).toEqual({
            changed: false,
            clicks: 0,
        });
    });
    it('expands Recents when the label or aria-expanded explicitly says it is collapsed', () => {
        expect(runExpandRecentScript('<button aria-label="Expand Recents">Recents</button>')).toEqual({
            changed: true,
            clicks: 1,
        });
        expect(runExpandRecentScript('<button aria-label="Recents" aria-expanded="false">Recents</button>')).toEqual({
            changed: true,
            clicks: 1,
        });
    });
    it('unwraps Browser Bridge envelopes for conversation lists', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            session: 'site:gemini',
            data: [{ title: 'Chat A', url: 'https://gemini.google.com/app/abc123' }],
        });
        await expect(getGeminiConversationList(page)).resolves.toEqual([
            { Title: 'Chat A', Url: 'https://gemini.google.com/app/abc123' },
        ]);
    });
    it('drops non-conversation /app affordances from conversation lists', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([
            { title: 'New chat', url: 'https://gemini.google.com/app' },
            { title: 'Chat A', url: 'https://gemini.google.com/app/abc123' },
        ]);
        await expect(getGeminiConversationList(page)).resolves.toEqual([
            { Title: 'Chat A', Url: 'https://gemini.google.com/app/abc123' },
        ]);
    });
    it('expands collapsed Recents and retries conversation extraction', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const wait = vi.mocked(page.wait);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce([
            { title: 'Recovered Chat', url: 'https://gemini.google.com/app/recovered123' },
        ]);
        await expect(getGeminiConversationList(page)).resolves.toEqual([
            { Title: 'Recovered Chat', Url: 'https://gemini.google.com/app/recovered123' },
        ]);
        expect(evaluate).toHaveBeenCalledTimes(4);
        expect(wait).toHaveBeenCalledWith(1.2);
    });
    it('does not expand Recents when visible conversation links already exist', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const wait = vi.mocked(page.wait);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([
            { title: 'Chat A', url: 'https://gemini.google.com/app/abc123' },
        ]);
        await expect(getGeminiConversationList(page)).resolves.toEqual([
            { Title: 'Chat A', Url: 'https://gemini.google.com/app/abc123' },
        ]);
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(wait).not.toHaveBeenCalled();
    });
    it('typed-fails malformed Browser Bridge envelopes instead of treating them as empty', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ session: 'site:gemini' });
        await expect(getGeminiConversationList(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('typed-fails malformed conversation list rows', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([{ title: 'Chat A' }]);
        await expect(getGeminiConversationList(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('unwraps structured turns and transcript fallback results', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            session: 'site:gemini',
            data: [{ Role: 'User', Text: 'hello' }],
        });
        await expect(getGeminiVisibleTurns(page)).resolves.toEqual([{ Role: 'User', Text: 'hello' }]);

        const fallbackPage = createPageMock();
        const fallbackEvaluate = vi.mocked(fallbackPage.evaluate);
        fallbackEvaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            session: 'site:gemini',
            data: ['plain transcript line'],
        });
        await expect(getGeminiVisibleTurns(fallbackPage)).resolves.toEqual([
            { Role: 'System', Text: 'plain transcript line' },
        ]);
    });
    it('typed-fails malformed visible turn rows', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce([{ Role: 'Assistant' }]);
        await expect(getGeminiVisibleTurns(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('unwraps and validates status and snapshot objects', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            session: 'site:gemini',
            data: { url: 'https://gemini.google.com/app', canSend: true, isSignedIn: true },
        });
        await expect(getGeminiPageState(page)).resolves.toMatchObject({ canSend: true });

        const snapshotPage = createPageMock();
        const snapshotEvaluate = vi.mocked(snapshotPage.evaluate);
        snapshotEvaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            session: 'site:gemini',
            data: {
                turns: [],
                transcriptLines: [],
                composerHasText: false,
                isGenerating: false,
                structuredTurnsTrusted: true,
            },
        });
        await expect(readGeminiSnapshot(snapshotPage)).resolves.toMatchObject({
            structuredTurnsTrusted: true,
        });
    });
    it('typed-fails malformed page snapshots', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({
            turns: {},
            transcriptLines: [],
            composerHasText: false,
            isGenerating: false,
            structuredTurnsTrusted: true,
        });
        await expect(readGeminiSnapshot(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
describe('pickGeminiDeepResearchExportUrl', () => {
    it('prefers docs.google.com document url over sheets and noise endpoints', () => {
        const picked = pickGeminiDeepResearchExportUrl([
            'xhr::https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D',
            'performance::https://docs.google.com/spreadsheets/d/1abc/edit',
            'open::https://docs.google.com/document/d/1docid/edit',
        ], 'https://gemini.google.com/app/abc');
        expect(picked).toEqual({
            url: 'https://docs.google.com/document/d/1docid/edit',
            source: 'window-open',
        });
    });
    it('returns none when only non-export telemetry urls are present', () => {
        const picked = pickGeminiDeepResearchExportUrl([
            'fetch::https://gemini.google.com/_/BardChatUi/cspreport',
            'performance::https://www.google-analytics.com/g/collect?v=2',
        ], 'https://gemini.google.com/app/abc');
        expect(picked).toEqual({ url: '', source: 'none' });
    });
});

// ── Model-picker detection DOM fixture tests ─────────────────────────────
// These tests verify that openModelPickerForThinkingScript,
// selectGeminiModelScript, and getCurrentGeminiModelScript share the same
// 4-method picker detection strategy as models.js (discoverModelsScript).

function createPickerDom(htmlFixture) {
    const dom = new JSDOM(`<!doctype html><body>${htmlFixture}</body>`, {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value() {
            return { width: 100, height: 24, top: 0, left: 0, right: 100, bottom: 24 };
        },
    });
    return { window, document: window.document };
}

function evalScript(window, scriptFn) {
    const scriptText = scriptFn();
    return window.eval(scriptText);
}

describe('openModelPickerForThinkingScript — picker detection', () => {
    it('Method 1: detects picker by aria-label "mode-selector"', () => {
        const { window } = createPickerDom(`
            <button aria-label="mode selector">Choose</button>
            <button>New chat</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 1: detects picker by aria-label "模式选择器"', () => {
        const { window } = createPickerDom(`
            <button aria-label="模式选择器">选择</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 1: detects picker by aria-label "model-picker"', () => {
        const { window } = createPickerDom(`
            <button aria-label="model picker">Pick</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 1: detects picker by aria-label "选择模型"', () => {
        const { window } = createPickerDom(`
            <button aria-label="选择模型">选择</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 2: detects picker by version-number text', () => {
        const { window } = createPickerDom(`
            <button>2.5 Flash</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 3: detects picker by variant-only text "Flash"', () => {
        const { window } = createPickerDom(`
            <button>Flash</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 3: detects picker by variant-only text "Pro"', () => {
        const { window } = createPickerDom(`
            <button>Pro</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 3: detects picker by variant-only text "Lite"', () => {
        const { window } = createPickerDom(`
            <button>Lite</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 3: detects picker by variant-only text "Flash-Lite"', () => {
        const { window } = createPickerDom(`
            <button>Flash-Lite</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('Method 4: detects picker by data-model-selector attribute', () => {
        const { window } = createPickerDom(`
            <button data-model-selector="true">Choose</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });

    it('returns { ok: false } when no picker is found', () => {
        const { window } = createPickerDom(`
            <button>New chat</button>
            <button>Sign in</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: false, reason: 'Model picker not found' });
    });

    it('Method 1 wins over Method 2 for ambiguous buttons', () => {
        // A button with both a model-selector aria-label and a version-like
        // text should still be found (Method 1 returns early).
        const { window } = createPickerDom(`
            <button aria-label="mode selector">3.0 Config</button>
        `);
        const result = evalScript(window, __test__.openModelPickerForThinkingScript);
        expect(result).toEqual({ ok: true });
    });
});

describe('selectGeminiModelScript — picker detection parity', () => {
    it('Method 1: detects picker by aria-label "mode-selector" and selects model', () => {
        const { window } = createPickerDom(`
            <button aria-label="mode selector">Choose</button>
            <div role="menu" style="display:none;">
              <button role="menuitem">2.5 Flash</button>
            </div>
        `);
        // Show the menu so the script can find menu items (just test picker detection).
        // The script will fail to find the model in the menu (shown), but we check
        // the picker was found by the aria-label.
        const result = evalScript(window, () => __test__.selectGeminiModelScript('2.5-flash'));
        // The menu is visible but doesn't contain the right items — we just care
        // that the picker was found (not the old "Model picker button not found" error).
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('not found in picker menu');
    });

    it('Method 3: detects picker by variant-only text "Flash" and attempts selection', () => {
        const { window } = createPickerDom(`
            <button>Flash</button>
            <div role="menu" style="display:none;">
              <button role="menuitem">2.5 Flash</button>
            </div>
        `);
        const result = evalScript(window, () => __test__.selectGeminiModelScript('2.5-flash'));
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('not found in picker menu');
    });
});

describe('getCurrentGeminiModelScript — picker detection parity', () => {
    it('Method 1: detects picker by aria-label "模式选择器"', () => {
        const { window } = createPickerDom(`
            <button aria-label="模式选择器">2.5 Flash</button>
        `);
        const result = window.eval(__test__.getCurrentGeminiModelScript());
        expect(result).toBe('2.5-flash');
    });

    it('Method 3: detects picker by variant-only text "Flash"', () => {
        const { window } = createPickerDom(`
            <button>Flash</button>
        `);
        const result = window.eval(__test__.getCurrentGeminiModelScript());
        expect(result).toBe('');
    });

    it('Method 2: detects picker by version-number text and extracts model id', () => {
        const { window } = createPickerDom(`
            <button>2.5 Pro</button>
        `);
        const result = window.eval(__test__.getCurrentGeminiModelScript());
        expect(result).toBe('2.5-pro');
    });
});

describe('Gemini model/thinking selection Browser Bridge envelopes', () => {
    it('unwraps envelopes while selecting a thinking level', async () => {
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } })
            .mockResolvedValueOnce({ session: 'site:gemini', data: true })
            .mockResolvedValueOnce({ session: 'site:gemini', data: 'Extended' });

        const result = await selectGeminiThinking(page, 'extended');

        expect(result).toBe('Extended');
        expect(page.evaluate).toHaveBeenCalledTimes(4);
    });

    it('unwraps envelopes while selecting a model', async () => {
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } })
            .mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } })
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce('2.5-flash');

        await expect(selectGeminiModel(page, '2.5-flash')).resolves.toBeUndefined();

        expect(page.evaluate).toHaveBeenCalledTimes(5);
    });

    it('typed-fails when model selection read-back does not match the requested model', async () => {
        const page = createPageMock();
        vi.mocked(page.evaluate)
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } })
            .mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } })
            .mockResolvedValueOnce('https://gemini.google.com/app')
            .mockResolvedValueOnce('2.5-pro');

        await expect(selectGeminiModel(page, '2.5-flash')).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
