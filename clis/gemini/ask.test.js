import { beforeEach, describe, expect, it, vi } from 'vitest';
const baseline = {
    turns: [{ Role: 'Assistant', Text: '旧回答' }],
    transcriptLines: ['baseline'],
    composerHasText: true,
    isGenerating: false,
    structuredTurnsTrusted: true,
};
const submission = {
    snapshot: {
        turns: [
            { Role: 'Assistant', Text: '旧回答' },
            { Role: 'User', Text: '请只回复：OK' },
        ],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
    },
    preSendAssistantCount: 1,
    userAnchorTurn: { Role: 'User', Text: '请只回复：OK' },
    reason: 'user_turn',
};
const mocks = vi.hoisted(() => ({
    readGeminiSnapshot: vi.fn(),
    sendGeminiMessage: vi.fn(),
    startNewGeminiChat: vi.fn(),
    waitForGeminiSubmission: vi.fn(),
    waitForGeminiResponse: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        readGeminiSnapshot: mocks.readGeminiSnapshot,
        sendGeminiMessage: mocks.sendGeminiMessage,
        startNewGeminiChat: mocks.startNewGeminiChat,
        waitForGeminiSubmission: mocks.waitForGeminiSubmission,
        waitForGeminiResponse: mocks.waitForGeminiResponse,
    };
});
import { DEFAULT_GEMINI_ASK_TIMEOUT_SECONDS, askCommand, parseGeminiAskTimeout } from './ask.js';
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
describe('gemini ask orchestration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('parses positive timeout values and falls back for invalid values', () => {
        expect(parseGeminiAskTimeout('120', 60)).toBe(120);
        expect(parseGeminiAskTimeout(300, 60)).toBe(300);
        expect(parseGeminiAskTimeout('0', 60)).toBe(60);
        expect(parseGeminiAskTimeout('-1', 60)).toBe(60);
        expect(parseGeminiAskTimeout('not-a-number', 60)).toBe(60);
    });
    it('uses the environment-backed default timeout when no timeout argument is provided', async () => {
        const page = createPageMock();
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(null);
        const result = await askCommand.func(page, { prompt: '请只回复：OK', new: 'false' });
        expect(mocks.waitForGeminiSubmission).toHaveBeenCalledWith(page, baseline, DEFAULT_GEMINI_ASK_TIMEOUT_SECONDS);
        expect(result).toEqual([{ response: `💬 [NO RESPONSE] No Gemini response within ${DEFAULT_GEMINI_ASK_TIMEOUT_SECONDS}s.` }]);
    });
    it('keeps the outer browser command timeout high enough for long explicit waits', () => {
        expect(askCommand.timeoutSeconds).toBeGreaterThanOrEqual(3600);
    });
    it('leaves timeout without a static default so the runtime env default can apply', () => {
        const timeoutArg = askCommand.args.find((arg) => arg.name === 'timeout');
        expect(timeoutArg.default).toBeUndefined();
    });
    it('captures baseline, sends, waits for confirmed submission, then waits with the remaining timeout', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');
        const result = await askCommand.func(page, { prompt: '请只回复：OK', timeout: '20', new: 'false' });
        expect(mocks.readGeminiSnapshot).toHaveBeenCalledWith(page);
        expect(mocks.waitForGeminiSubmission).toHaveBeenCalledWith(page, baseline, 20);
        expect(mocks.waitForGeminiResponse).toHaveBeenCalledWith(page, submission, '请只回复：OK', 18);
        expect(result).toEqual([{ response: '💬 OK' }]);
    });
    it('does not spend extra response wait time after submission has already consumed the full timeout budget', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(20000);
        const page = createPageMock();
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('');
        await askCommand.func(page, { prompt: '请只回复：OK', timeout: '20', new: 'false' });
        expect(mocks.waitForGeminiResponse).toHaveBeenCalledWith(page, submission, '请只回复：OK', 0);
    });
});
