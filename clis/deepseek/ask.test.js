import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const {
  mockEnsureOnDeepSeek,
  mockSelectModel,
  mockSetFeature,
  mockSendMessage,
  mockSendWithFile,
  mockGetBubbleCount,
  mockWaitForResponse,
  mockParseBoolFlag,
  mockWithRetry,
} = vi.hoisted(() => ({
  mockEnsureOnDeepSeek: vi.fn(),
  mockSelectModel: vi.fn(),
  mockSetFeature: vi.fn(),
  mockSendMessage: vi.fn(),
  mockSendWithFile: vi.fn(),
  mockGetBubbleCount: vi.fn(),
  mockWaitForResponse: vi.fn(),
  mockParseBoolFlag: vi.fn((v) => v === true || v === 'true'),
  mockWithRetry: vi.fn(async (fn) => fn()),
}));

vi.mock('./utils.js', () => ({
  DEEPSEEK_DOMAIN: 'chat.deepseek.com',
  DEEPSEEK_URL: 'https://chat.deepseek.com/',
  ensureOnDeepSeek: mockEnsureOnDeepSeek,
  selectModel: mockSelectModel,
  setFeature: mockSetFeature,
  sendMessage: mockSendMessage,
  sendWithFile: mockSendWithFile,
  getBubbleCount: mockGetBubbleCount,
  waitForResponse: mockWaitForResponse,
  parseBoolFlag: mockParseBoolFlag,
  withRetry: mockWithRetry,
}));

import { askCommand } from './ask.js';

describe('deepseek ask --file', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureOnDeepSeek.mockResolvedValue(undefined);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendWithFile.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(7);
    mockWaitForResponse.mockResolvedValue('new reply');
  });

  it('captures the existing baseline before sending a file prompt', async () => {
    const rows = await askCommand.func(page, {
      prompt: 'summarize this',
      timeout: 120,
      file: './report.pdf',
      new: false,
      model: 'instant',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'new reply' }]);
    expect(mockGetBubbleCount).toHaveBeenCalledTimes(1);
    expect(mockSendWithFile).toHaveBeenCalledWith(page, './report.pdf', 'summarize this');
    expect(mockWaitForResponse).toHaveBeenCalledWith(page, 7, 'summarize this', 120000, false);
  });

  it('still fails when explicit instant model selection cannot be verified', async () => {
    mockSelectModel.mockResolvedValue({ ok: false });

    await expect(askCommand.func(page, {
      prompt: 'summarize this',
      timeout: 120,
      new: false,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError('Could not switch to instant model'));
  });
});

describe('deepseek ask --think', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureOnDeepSeek.mockResolvedValue(undefined);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(5);
  });

  it('returns separate thinking and response fields when --think is enabled', async () => {
    mockWaitForResponse.mockResolvedValue({
      response: 'The answer is 42.',
      thinking: 'Let me analyze this...',
      thinking_time: '2.5',
    });

    const rows = await askCommand.func(page, {
      prompt: 'what is the answer?',
      timeout: 120,
      new: false,
      model: 'instant',
      think: true,
      search: false,
    });

    expect(rows).toEqual([{
      response: 'The answer is 42.',
      thinking: 'Let me analyze this...',
      thinking_time: '2.5',
    }]);
    expect(mockWaitForResponse).toHaveBeenCalledWith(page, 5, 'what is the answer?', 120000, true);
  });

  it('returns plain response when --think is disabled', async () => {
    mockWaitForResponse.mockResolvedValue('The answer is 42.');

    const rows = await askCommand.func(page, {
      prompt: 'what is the answer?',
      timeout: 120,
      new: false,
      model: 'instant',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'The answer is 42.' }]);
    expect(mockWaitForResponse).toHaveBeenCalledWith(page, 5, 'what is the answer?', 120000, false);
  });

  it('includes thinking and thinking_time columns', () => {
    expect(askCommand.columns).toEqual(['response', 'thinking', 'thinking_time']);
  });
});
