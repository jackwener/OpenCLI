import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

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
  reason: 'user_turn' as const,
};

const mocks = vi.hoisted(() => ({
  readGeminiSnapshot: vi.fn(),
  sendGeminiMessage: vi.fn(),
  startNewGeminiChat: vi.fn(),
  waitForGeminiSubmission: vi.fn(),
  waitForGeminiResponse: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    readGeminiSnapshot: mocks.readGeminiSnapshot,
    sendGeminiMessage: mocks.sendGeminiMessage,
    startNewGeminiChat: mocks.startNewGeminiChat,
    waitForGeminiSubmission: mocks.waitForGeminiSubmission,
    waitForGeminiResponse: mocks.waitForGeminiResponse,
  };
});

import { askCommand } from './ask.js';

function createPageMock(): IPage {
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
  } as unknown as IPage;
}

describe('gemini ask orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await askCommand.func!(page, { prompt: '请只回复：OK', timeout: '20', new: 'false' });

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

    await askCommand.func!(page, { prompt: '请只回复：OK', timeout: '20', new: 'false' });

    expect(mocks.waitForGeminiResponse).toHaveBeenCalledWith(page, submission, '请只回复：OK', 0);
  });
});
