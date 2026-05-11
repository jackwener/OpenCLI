import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';

const {
  mockEnsureOnDeepSeek,
  mockGetVisibleMessages,
} = vi.hoisted(() => ({
  mockEnsureOnDeepSeek: vi.fn(),
  mockGetVisibleMessages: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual('./utils.js');
  return {
    ...actual,
    ensureOnDeepSeek: mockEnsureOnDeepSeek,
    getVisibleMessages: mockGetVisibleMessages,
  };
});

import './detail.js';

describe('deepseek detail', () => {
  const command = getRegistry().get('deepseek/detail');
  const id = '749e6bbd-6a45-4440-beaa-ae5238bf06d8';

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureOnDeepSeek.mockResolvedValue(false);
  });

  it('registers as a cookie-browser read command', () => {
    expect(command).toBeDefined();
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('cookie');
    expect(command.access).toBe('read');
    expect(command.columns).toEqual(['Role', 'Text']);
  });

  it('navigates to the conversation URL and returns visible messages', async () => {
    mockGetVisibleMessages.mockResolvedValue([
      { Role: 'user', Text: 'hello' },
      { Role: 'assistant', Text: 'hi' },
    ]);
    const page = { wait: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined) };

    const rows = await command.func(page, { id });

    expect(rows).toEqual([
      { Role: 'user', Text: 'hello' },
      { Role: 'assistant', Text: 'hi' },
    ]);
    expect(page.goto).toHaveBeenCalledWith(`https://chat.deepseek.com/a/chat/s/${id}`);
    expect(mockGetVisibleMessages).toHaveBeenCalledWith(page);
  });

  it('accepts a full chat URL and normalises it before navigation', async () => {
    mockGetVisibleMessages.mockResolvedValue([{ Role: 'user', Text: 'hi' }]);
    const page = { wait: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined) };

    await command.func(page, { id: `https://chat.deepseek.com/a/chat/s/${id.toUpperCase()}?ref=foo` });

    expect(page.goto).toHaveBeenCalledWith(`https://chat.deepseek.com/a/chat/s/${id}`);
  });

  it('rejects malformed IDs before browser navigation', async () => {
    const page = { wait: vi.fn(), goto: vi.fn() };

    await expect(command.func(page, { id: 'not-a-uuid' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
    expect(mockEnsureOnDeepSeek).not.toHaveBeenCalled();
  });

  it('throws EmptyResultError when the conversation has no visible messages', async () => {
    mockGetVisibleMessages.mockResolvedValue([]);
    const page = { wait: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined) };

    await expect(command.func(page, { id })).rejects.toThrow(EmptyResultError);
  });
});
