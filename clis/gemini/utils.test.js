import { describe, expect, it, vi } from 'vitest';
import { __test__, collectGeminiTranscriptAdditions, pickGeminiDeepResearchExportUrl, sanitizeGeminiResponseText, sendGeminiMessage, } from './utils.js';
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
