import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, CommandExecutionError, EXIT_CODES, TimeoutError } from '@jackwener/opencli/errors';

const {
  mockEnsureOnDeepSeek,
  mockEnsureFreshConversation,
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
  mockEnsureFreshConversation: vi.fn(),
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
  TEXTAREA_SELECTOR: 'textarea[placeholder*="DeepSeek"]',
  ensureOnDeepSeek: mockEnsureOnDeepSeek,
  ensureFreshConversation: mockEnsureFreshConversation,
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
      'Run without --search, or use --model instant for web search.',
      EXIT_CODES.USAGE_ERROR,
    ));

    expect(page.goto).not.toHaveBeenCalled();
    expect(mockEnsureOnDeepSeek).not.toHaveBeenCalled();
    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSetFeature).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendWithFile).not.toHaveBeenCalled();
  });

  it('skips search toggle in expert mode when search is not requested', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(0);
    mockWaitForResponse.mockResolvedValue('expert reply');
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');

    const rows = await askCommand.func(page, {
      prompt: 'analyze',
      timeout: 120,
      new: false,
      model: 'expert',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'expert reply' }]);
    expect(mockSetFeature).toHaveBeenCalledTimes(1);
    expect(mockSetFeature).toHaveBeenCalledWith(expect.anything(), 'DeepThink', false);
  });

  it('fails fast instead of silently ignoring --search in expert mode', async () => {
    mockEnsureOnDeepSeek.mockResolvedValue(false);
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');

    await expect(askCommand.func(page, {
      prompt: 'analyze',
      timeout: 120,
      new: false,
      model: 'expert',
      think: false,
      search: true,
    })).rejects.toMatchObject(new CliError(
      'ARGUMENT',
      'DeepSeek expert mode does not support --search.',
      'Run without --search, or use --model instant for web search.',
      EXIT_CODES.USAGE_ERROR,
    ));

    expect(page.goto).not.toHaveBeenCalled();
    expect(mockEnsureOnDeepSeek).not.toHaveBeenCalled();
    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSetFeature).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendWithFile).not.toHaveBeenCalled();
  });
});

describe('deepseek ask --new session guarantee', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/');
    mockEnsureFreshConversation.mockResolvedValue({ ok: true, escaped: false });
    mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
    mockSetFeature.mockResolvedValue({ ok: true, toggled: false });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(0);
    mockWaitForResponse.mockResolvedValue('fresh reply');
  });

  it('delegates --new navigation to ensureFreshConversation', async () => {
    const rows = await askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    });

    expect(rows).toEqual([{ response: 'fresh reply' }]);
    expect(mockEnsureFreshConversation).toHaveBeenCalledWith(page);
    // Navigation is owned by the helper now; the command must not race it
    // with its own goto or fall back to the resume path.
    expect(page.goto).not.toHaveBeenCalled();
    expect(mockEnsureOnDeepSeek).not.toHaveBeenCalled();
    expect(mockPickResumeUrl).not.toHaveBeenCalled();
  });

  it('fails fast instead of appending to the restored conversation', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'conversation-restored' });

    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation, so --new could not start a fresh thread (conversation-restored)',
      'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
    ));

    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when the SPA restores the thread after the helper reported success', async () => {
    // The helper's settle wait is best-effort, so the restore can land after
    // it returned ok — the settled URL is the last line of defense.
    page.evaluate.mockResolvedValue('https://chat.deepseek.com/a/chat/s/some-id');

    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation, so --new could not start a fresh thread (conversation-restored)',
      'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
    ));

    expect(mockSelectModel).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when the baseline shows the send would land in a non-empty conversation', async () => {
    // URL checks are racy snapshots; the empty-baseline check right before
    // the send is the timing-independent --new guard. A restore that slips
    // past every URL check still surfaces here as pre-existing bubbles.
    mockGetBubbleCount.mockResolvedValue(4);

    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation, so --new could not start a fresh thread (conversation-restored)',
      'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
    ));

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('applies the baseline guard to --file sends too', async () => {
    // The baseline is collected once, before the file/plain branch split;
    // this locks the guard in front of sendWithFile so a refactor cannot
    // move the collection back inside only the plain-text path.
    mockGetBubbleCount.mockResolvedValue(4);

    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
      file: 'C:/tmp/report.pdf',
    })).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation, so --new could not start a fresh thread (conversation-restored)',
      'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
    ));

    expect(mockSendWithFile).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('fails fast when the sidebar offers no new-chat control, and names that reason', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'new-chat-control-not-found' });

    // The reason distinguishes a DeepSeek UI change (missing control) from a
    // restore race, so it must survive into the user-facing error.
    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation, so --new could not start a fresh thread (new-chat-control-not-found)',
      'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
    ));

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('keeps the login-page behavior: composer-missing defers to downstream typed errors', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'composer-missing' });
    mockSelectModel.mockResolvedValue({ ok: false });

    await expect(askCommand.func(page, {
      prompt: 'sample question',
      timeout: 120,
      new: true,
      model: 'instant',
      think: false,
      search: false,
    })).rejects.toThrow(new CommandExecutionError('Could not switch to instant model'));
  });
});

describe('deepseek ask timeout surfaces TimeoutError (not a silent sentinel row)', () => {
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
    mockSendWithFile.mockResolvedValue({ ok: true });
    mockGetBubbleCount.mockResolvedValue(3);
    // No reply within the window.
    mockWaitForResponse.mockResolvedValue(null);
  });

  it('throws TimeoutError on the normal send path when no reply arrives', async () => {
    await expect(askCommand.func(page, {
      prompt: 'hello', timeout: 30, new: false, model: 'default', think: false, search: false,
    })).rejects.toThrow(TimeoutError);
  });

  it('throws TimeoutError on the --file path when no reply arrives', async () => {
    await expect(askCommand.func(page, {
      prompt: 'summarize', timeout: 30, file: './report.pdf', new: false, model: 'instant', think: false, search: false,
    })).rejects.toThrow(TimeoutError);
  });
});
