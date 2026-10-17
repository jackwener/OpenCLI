import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockClickGeminiConversationByTitle, mockExportGeminiDeepResearchReport, mockGetGeminiConversationList, mockGetGeminiPageState, mockGetLatestGeminiAssistantResponse, mockReadGeminiSnapshot, mockResolveGeminiConversationForQuery, mockWaitForGeminiTranscript, } = vi.hoisted(() => ({
    mockClickGeminiConversationByTitle: vi.fn(),
    mockExportGeminiDeepResearchReport: vi.fn(),
    mockGetGeminiConversationList: vi.fn(),
    mockGetGeminiPageState: vi.fn(),
    mockGetLatestGeminiAssistantResponse: vi.fn(),
    mockReadGeminiSnapshot: vi.fn(),
    mockResolveGeminiConversationForQuery: vi.fn(),
    mockWaitForGeminiTranscript: vi.fn(),
}));
vi.mock('./utils.js', () => ({
    GEMINI_DOMAIN: 'gemini.google.com',
    clickGeminiConversationByTitle: mockClickGeminiConversationByTitle,
    exportGeminiDeepResearchReport: mockExportGeminiDeepResearchReport,
    getGeminiConversationList: mockGetGeminiConversationList,
    getGeminiPageState: mockGetGeminiPageState,
    getLatestGeminiAssistantResponse: mockGetLatestGeminiAssistantResponse,
    readGeminiSnapshot: mockReadGeminiSnapshot,
    parseGeminiConversationUrl: (value) => {
        const raw = String(value ?? '').trim();
        return raw.startsWith('https://gemini.google.com/app/') ? raw : null;
    },
    parseGeminiTitleMatchMode: (value) => {
        const raw = String(value ?? 'contains').trim().toLowerCase();
        if (raw === 'contains' || raw === 'exact')
            return raw;
        return null;
    },
    resolveGeminiConversationForQuery: mockResolveGeminiConversationForQuery,
    waitForGeminiTranscript: mockWaitForGeminiTranscript,
}));
import { deepResearchResultCommand } from './deep-research-result.js';
describe('gemini/deep-research-result', () => {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetGeminiPageState.mockResolvedValue({ isSignedIn: true });
        mockGetGeminiConversationList.mockResolvedValue([{ Title: 'A title', Url: 'https://gemini.google.com/app/abc' }]);
        mockResolveGeminiConversationForQuery.mockReturnValue({ Title: 'A title', Url: 'https://gemini.google.com/app/abc' });
        mockClickGeminiConversationByTitle.mockResolvedValue(true);
        mockWaitForGeminiTranscript.mockResolvedValue(['line']);
        mockExportGeminiDeepResearchReport.mockResolvedValue({ url: 'https://files.example.com/report.md', source: 'network' });
        mockGetLatestGeminiAssistantResponse.mockResolvedValue('Final answer');
        mockReadGeminiSnapshot.mockResolvedValue({
            turns: [],
            transcriptLines: [],
            composerHasText: false,
            isGenerating: false,
            structuredTurnsTrusted: true,
        });
    });
    const runCommand = (kwargs) => deepResearchResultCommand.func(page, { timeout: 120, ...kwargs });
    it('uses latest conversation when query is empty', async () => {
        const result = await runCommand({ query: '   ' });
        expect(page.goto).toHaveBeenCalledWith('https://gemini.google.com/app/abc', { waitUntil: 'load', settleMs: 2500 });
        expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
    });

    it('returns a validation message when match mode is invalid', async () => {
        const result = await runCommand({ query: 'A', match: 'prefix' });
        expect(result).toEqual([{ response: 'Invalid match mode. Use contains or exact.' }]);
    });

    it('opens matched conversation by URL and returns exported report url', async () => {
        const result = await runCommand({ query: 'A title', match: 'exact' });
        expect(page.goto).toHaveBeenCalledWith('https://gemini.google.com/app/abc', { waitUntil: 'load', settleMs: 2500 });
        expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
    });
    it('accepts a direct conversation URL and reads response from that page', async () => {
        const url = 'https://gemini.google.com/app/direct-id';
        const result = await runCommand({ query: url, match: 'contains' });
        expect(page.goto).toHaveBeenCalledWith(url, { waitUntil: 'load', settleMs: 2500 });
        expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
    });
    it('passes query and mode into resolveGeminiConversationForQuery', async () => {
        const result = await runCommand({ query: 'title', match: 'contains' });
        expect(mockResolveGeminiConversationForQuery).toHaveBeenCalledWith([{ Title: 'A title', Url: 'https://gemini.google.com/app/abc' }], 'title', 'contains');
        expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
    });

});
