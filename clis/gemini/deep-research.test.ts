import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

const {
  mockGetCurrentGeminiUrl,
  mockReadGeminiSnapshot,
  mockSelectGeminiTool,
  mockSendGeminiMessage,
  mockStartNewGeminiChat,
  mockWaitForGeminiSubmission,
  mockWaitForGeminiConfirmButton,
  mockGetLatestGeminiAssistantResponse,
} = vi.hoisted(() => ({
  mockGetCurrentGeminiUrl: vi.fn<() => Promise<string>>(),
  mockReadGeminiSnapshot: vi.fn<() => Promise<any>>(),
  mockSelectGeminiTool: vi.fn<() => Promise<string>>(),
  mockSendGeminiMessage: vi.fn<() => Promise<void>>(),
  mockStartNewGeminiChat: vi.fn<() => Promise<void>>(),
  mockWaitForGeminiSubmission: vi.fn<() => Promise<any>>(),
  mockWaitForGeminiConfirmButton: vi.fn<() => Promise<string>>(),
  mockGetLatestGeminiAssistantResponse: vi.fn<() => Promise<string>>(),
}));

vi.mock('./utils.js', () => ({
  GEMINI_DOMAIN: 'gemini.google.com',
  GEMINI_APP_URL: 'https://gemini.google.com/app',
  GEMINI_DEEP_RESEARCH_DEFAULT_TOOL_LABELS: ['Deep Research', 'Deep research', '\u6df1\u5ea6\u7814\u7a76'],
  GEMINI_DEEP_RESEARCH_DEFAULT_CONFIRM_LABELS: [
    'Start research',
    'Start Research',
    'Start deep research',
    'Start Deep Research',
    'Generate research plan',
    'Generate Research Plan',
    'Generate deep research plan',
    'Generate Deep Research Plan',
    '\u5f00\u59cb\u7814\u7a76',
    '\u5f00\u59cb\u6df1\u5ea6\u7814\u7a76',
    '\u5f00\u59cb\u8c03\u7814',
    '\u751f\u6210\u7814\u7a76\u8ba1\u5212',
    '\u751f\u6210\u8c03\u7814\u8ba1\u5212',
  ],
  parseGeminiPositiveInt: (value: unknown, fallback: number) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  },
  resolveGeminiLabels: (value: unknown, fallback: string[]) => {
    const label = String(value ?? '').trim();
    return label ? [label] : fallback;
  },
  getCurrentGeminiUrl: mockGetCurrentGeminiUrl,
  getLatestGeminiAssistantResponse: mockGetLatestGeminiAssistantResponse,
  readGeminiSnapshot: mockReadGeminiSnapshot,
  selectGeminiTool: mockSelectGeminiTool,
  sendGeminiMessage: mockSendGeminiMessage,
  startNewGeminiChat: mockStartNewGeminiChat,
  waitForGeminiSubmission: mockWaitForGeminiSubmission,
  waitForGeminiConfirmButton: mockWaitForGeminiConfirmButton,
}));

import { deepResearchCommand } from './deep-research.js';

describe('gemini/deep-research', () => {
  const page = {} as IPage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentGeminiUrl.mockResolvedValue('https://gemini.google.com/app/chat');
    mockReadGeminiSnapshot.mockResolvedValue({
      turns: [],
      transcriptLines: [],
      composerHasText: false,
      isGenerating: false,
      structuredTurnsTrusted: true,
    });
    mockSelectGeminiTool.mockResolvedValue('Deep Research');
    mockSendGeminiMessage.mockResolvedValue();
    mockStartNewGeminiChat.mockResolvedValue();
    mockWaitForGeminiSubmission.mockResolvedValue({
      snapshot: { turns: [], transcriptLines: [], composerHasText: false, isGenerating: false, structuredTurnsTrusted: true },
      preSendAssistantCount: 0,
      userAnchorTurn: null,
      reason: 'user_turn',
    });
    mockWaitForGeminiConfirmButton.mockResolvedValue('Start research');
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('');
  });

  it('starts a new chat by default, then sends prompt and confirms deep research', async () => {
    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(mockStartNewGeminiChat).toHaveBeenCalledTimes(1);
    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(1);
    expect(mockSendGeminiMessage).toHaveBeenCalledWith(page, 'research this topic');
    expect(mockWaitForGeminiSubmission).toHaveBeenCalledTimes(1);
    expect(mockWaitForGeminiConfirmButton).toHaveBeenCalledWith(
      page,
      expect.arrayContaining(['Start research', 'Start deep research', 'Generate research plan', '\u751f\u6210\u7814\u7a76\u8ba1\u5212']),
      30,
    );
    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/chat' }]);
  });

  it('returns tool-not-found when the tool cannot be selected', async () => {
    mockSelectGeminiTool.mockResolvedValue('');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(result).toEqual([{ status: 'tool-not-found', url: 'https://gemini.google.com/app/chat' }]);
    expect(mockSendGeminiMessage).not.toHaveBeenCalled();
    expect(mockWaitForGeminiSubmission).not.toHaveBeenCalled();
    expect(mockWaitForGeminiConfirmButton).not.toHaveBeenCalled();
  });

  it('retries send once when first submission cannot be confirmed', async () => {
    mockWaitForGeminiSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce({
      snapshot: { turns: [], transcriptLines: [], composerHasText: false, isGenerating: false, structuredTurnsTrusted: true },
      preSendAssistantCount: 0,
      userAnchorTurn: null,
      reason: 'user_turn',
    });

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(2);
    expect(mockReadGeminiSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(2);
    expect(mockWaitForGeminiSubmission).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/chat' }]);
  });

  it('returns submit-not-found when submission cannot be confirmed after retry', async () => {
    mockWaitForGeminiSubmission.mockResolvedValue(null);

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(2);
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(2);
    expect(mockWaitForGeminiConfirmButton).not.toHaveBeenCalled();
    expect(result).toEqual([{ status: 'submit-not-found', url: 'https://gemini.google.com/app/chat' }]);
  });

  it('returns confirm-not-found when no confirm button is found', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValue('');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(result).toEqual([{ status: 'confirm-not-found', url: 'https://gemini.google.com/app/chat' }]);
  });

  it('returns started when confirm is missing but research appears to be running', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValue('');
    mockGetCurrentGeminiUrl.mockResolvedValue('https://gemini.google.com/app/abc123');
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Researching websites now');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/abc123' }]);
  });

  it('does not treat conversation url alone as started when confirm is missing', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValue('');
    mockGetCurrentGeminiUrl.mockResolvedValue('https://gemini.google.com/app/abc999');
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('I drafted a plan. Start research');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic' });

    expect(result).toEqual([{ status: 'confirm-not-found', url: 'https://gemini.google.com/app/abc999' }]);
  });

  it('retries once when stuck on root app URL and starts successfully on second confirm', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValueOnce('').mockResolvedValueOnce('Start research');
    mockGetCurrentGeminiUrl.mockResolvedValueOnce('https://gemini.google.com/app').mockResolvedValueOnce('https://gemini.google.com/app/retry123');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic', timeout: '20' });

    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(2);
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(1);
    expect(mockWaitForGeminiConfirmButton).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/retry123' }]);
  });

  it('treats root-url confirm as false-positive and retries', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValueOnce('Start research').mockResolvedValueOnce('Start research');
    mockGetCurrentGeminiUrl.mockResolvedValueOnce('https://gemini.google.com/app').mockResolvedValueOnce('https://gemini.google.com/app/retry456');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic', timeout: '20' });

    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(2);
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/retry456' }]);
  });

  it('does not resend prompt during root-url retry to avoid duplicate chats', async () => {
    mockWaitForGeminiConfirmButton.mockResolvedValueOnce('Start research').mockResolvedValueOnce('');
    mockGetCurrentGeminiUrl.mockResolvedValueOnce('https://gemini.google.com/app').mockResolvedValueOnce('https://gemini.google.com/app');
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic', timeout: '20' });

    expect(mockSelectGeminiTool).toHaveBeenCalledTimes(2);
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(1);
    expect(mockWaitForGeminiConfirmButton).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ status: 'confirm-not-found', url: 'https://gemini.google.com/app' }]);
  });

  it('attempts one more confirm click when still waiting for start research', async () => {
    mockWaitForGeminiConfirmButton
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Start research');
    mockGetCurrentGeminiUrl
      .mockResolvedValueOnce('https://gemini.google.com/app/xyz123')
      .mockResolvedValueOnce('https://gemini.google.com/app/xyz123');
    mockGetLatestGeminiAssistantResponse
      .mockResolvedValueOnce('I drafted a plan. Start research')
      .mockResolvedValueOnce('Researching websites now');

    const result = await deepResearchCommand.func!(page, { prompt: 'research this topic', timeout: '20' });

    expect(mockWaitForGeminiConfirmButton).toHaveBeenCalledTimes(2);
    expect(mockWaitForGeminiConfirmButton).toHaveBeenNthCalledWith(
      2,
      page,
      expect.arrayContaining(['Start research', 'Start deep research', '开始研究', '开始深度研究']),
      8,
    );
    expect(mockSendGeminiMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ status: 'started', url: 'https://gemini.google.com/app/xyz123' }]);
  });

  it('uses custom tool/confirm labels when provided', async () => {
    await deepResearchCommand.func!(page, {
      prompt: 'research this topic',
      tool: 'Custom Tool',
      confirm: 'Custom Confirm',
      timeout: '42',
    });

    expect(mockSelectGeminiTool).toHaveBeenCalledWith(page, ['Custom Tool']);
    expect(mockWaitForGeminiConfirmButton).toHaveBeenCalledWith(page, ['Custom Confirm'], 42);
  });
});
