import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const { mockEnsureFreshConversation } = vi.hoisted(() => ({
  mockEnsureFreshConversation: vi.fn(),
}));

vi.mock('./utils.js', () => ({
  DEEPSEEK_DOMAIN: 'chat.deepseek.com',
  ensureFreshConversation: mockEnsureFreshConversation,
}));

import { newCommand } from './new.js';

describe('deepseek new', () => {
  const page = {
    wait: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers command shape', () => {
    expect(newCommand.site).toBe('deepseek');
    expect(newCommand.name).toBe('new');
    expect(newCommand.strategy).toBe('cookie');
    expect(newCommand.browser).toBe(true);
    // Starting a new chat mutates session state, and only write commands get
    // the persistent-session lease.
    expect(newCommand.access).toBe('write');
  });

  it('reports success only after the helper confirms a fresh thread', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: true, escaped: true });

    const rows = await newCommand.func(page, {});

    expect(rows).toEqual([{ Status: 'New chat started' }]);
    expect(mockEnsureFreshConversation).toHaveBeenCalledWith(page);
  });

  it('throws when the composer never mounts (login or error page)', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'composer-missing' });

    await expect(newCommand.func(page, {})).rejects.toThrow(new CommandExecutionError(
      'DeepSeek composer did not mount within 8 s',
      'Verify you are logged into chat.deepseek.com.',
    ));
  });

  it('no longer reports success when DeepSeek restored the previous conversation', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'conversation-restored' });

    await expect(newCommand.func(page, {})).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation instead of starting a new chat (conversation-restored)',
      'Retry, or start a new chat manually at chat.deepseek.com.',
    ));
  });

  it('names the missing new-chat control so a DeepSeek UI change is diagnosable', async () => {
    mockEnsureFreshConversation.mockResolvedValue({ ok: false, reason: 'new-chat-control-not-found' });

    await expect(newCommand.func(page, {})).rejects.toThrow(new CommandExecutionError(
      'DeepSeek restored the previous conversation instead of starting a new chat (new-chat-control-not-found)',
      'Retry, or start a new chat manually at chat.deepseek.com.',
    ));
  });
});
