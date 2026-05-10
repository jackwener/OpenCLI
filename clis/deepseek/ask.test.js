import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';

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
  mockPickResumeUrl,
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
  mockPickResumeUrl: vi.fn(),
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
  pickResumeUrl: mockPickResumeUrl,
}));

import { askCommand } from './ask.js';

describe('deepseek ask --file', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue('https://chat.deepseek.com/'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');
    mockEnsureOnDeepSeek.mockResolvedValue(false);
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
    evaluate: vi.fn().mockResolvedValue('https://chat.deepseek.com/'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');
    mockEnsureOnDeepSeek.mockResolvedValue(false);
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

  it('does not declare static columns (derived from row keys)', () => {
    // columns should be undefined so the renderer infers from row keys,
    // avoiding empty trailing columns on non-think output.
    expect(askCommand.columns).toBeUndefined();
  });

  it('non-think rows only contain response key', async () => {
    mockWaitForResponse.mockResolvedValue('Plain answer.');

    const rows = await askCommand.func(page, {
      prompt: 'hello',
      timeout: 120,
      new: false,
      model: 'instant',
      think: false,
      search: false,
    });

    // Row keys drive rendered columns; no thinking/thinking_time present.
    expect(Object.keys(rows[0])).toEqual(['response']);
  });
});

describe('deepseek ask conversation resume', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(2);
    mockWaitForResponse.mockResolvedValue('follow-up reply');
  });

  it('resumes the most recent conversation and skips model selection', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(true);
    mockPickResumeUrl.mockResolvedValue('https://chat.deepseek.com/a/chat/s/abc-123');
    // URL check after resume navigation: now inside a conversation.
    page.evaluate.mockResolvedValueOnce('https://chat.deepseek.com/a/chat/s/abc-123');

    const rows = await askCommand.func(page, {
      prompt: 'follow up',
      timeout: 120,
      new: false,
      model: 'instant',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'follow-up reply' }]);
    expect(page.goto).toHaveBeenCalledWith('https://chat.deepseek.com/a/chat/s/abc-123');
    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('skips model selection when already inside an existing conversation', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/a/chat/s/abc-123');

    const rows = await askCommand.func(page, {
      prompt: 'continue',
      timeout: 120,
      new: false,
      model: 'expert',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'follow-up reply' }]);
    expect(mockSelectModel).not.toHaveBeenCalled();
  });

  it('fails fast when --model is explicitly requested inside an existing conversation', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/a/chat/s/abc-123');

    await expect(askCommand.func(page, {
      prompt: 'continue',
      timeout: 120,
      new: false,
      model: 'expert',
      think: false,
      search: false,
      __opencliOptionSources: { model: 'cli' },
    })).rejects.toMatchObject(new CliError(
      'ARGUMENT',
      'Cannot switch to expert model inside an existing conversation.',
      'Re-run with --new to start a fresh chat before selecting a model.',
      EXIT_CODES.USAGE_ERROR,
    ));

    expect(mockSelectModel).not.toHaveBeenCalled();
  });

  it('fails fast when the workspace was recycled but no conversation surfaces in time', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(true);
    mockPickResumeUrl.mockResolvedValue(null);

    await expect(askCommand.func(page, {
      prompt: 'hello',
      timeout: 120,
      new: false,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toBeInstanceOf(CommandExecutionError);

    expect(page.goto).not.toHaveBeenCalled();
    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('skips search toggle in vision mode when search is not requested', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(0);
    mockWaitForResponse.mockResolvedValue('vision reply');
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');

    const rows = await askCommand.func(page, {
      prompt: 'describe',
      timeout: 120,
      new: false,
      model: 'vision',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'vision reply' }]);
    expect(mockSetFeature).toHaveBeenCalledTimes(1);
    expect(mockSetFeature).toHaveBeenCalledWith(expect.anything(), 'DeepThink', false);
  });

  it('fails fast instead of silently ignoring --search in vision mode', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');

    await expect(askCommand.func(page, {
      prompt: 'describe',
      timeout: 120,
      new: false,
      model: 'vision',
      think: false,
      search: true,
    })).rejects.toMatchObject(new CliError(
      'ARGUMENT',
      'DeepSeek vision mode does not support --search.',
      'Run without --search, or use --model instant/expert for web search.',
      EXIT_CODES.USAGE_ERROR,
    ));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendWithFile).not.toHaveBeenCalled();
  });
});
