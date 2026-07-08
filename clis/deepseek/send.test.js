import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';

import './send.js';

describe('deepseek send', () => {
  const command = getRegistry().get('deepseek/send');
  const id = '749e6bbd-6a45-4440-beaa-ae5238bf06d8';

  function createPage(overrides = {}) {
    return {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
      nativeType: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(''),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers as a cookie-browser write command with id + prompt positional args', () => {
    expect(command).toBeDefined();
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('cookie');
    expect(command.access).toBe('write');
    expect(command.columns).toEqual(['Status', 'InjectedText']);
    expect(command.args.map((a) => a.name)).toEqual(['id', 'prompt', 'timeout']);
    expect(command.args.find((a) => a.name === 'timeout')).toMatchObject({ type: 'int', default: 60 });
  });

  it('rejects malformed conversation IDs before any browser navigation', async () => {
    const page = createPage();
    await expect(command.func(page, { id: 'not-a-uuid', prompt: 'hi' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.nativeType).not.toHaveBeenCalled();
  });

  it('navigates to the conversation, drives input through nativeType, and verifies the bubble', async () => {
    const page = createPage();
    page.evaluate
      .mockResolvedValueOnce(true)             // waitForTextareaReady probe
      .mockResolvedValueOnce(true)             // focus check
      .mockResolvedValueOnce({ ok: true });    // submit + verify IIFE

    const rows = await command.func(page, { id, prompt: 'hello' });

    expect(rows).toEqual([{ Status: 'Success', InjectedText: 'hello' }]);
    expect(page.goto).toHaveBeenCalledWith(`https://chat.deepseek.com/a/chat/s/${id}`);
    expect(page.nativeType).toHaveBeenCalledWith('hello');
  });

  it('throws when the textarea never mounts within the readiness timeout', async () => {
    const page = createPage();
    page.evaluate.mockResolvedValue(false);    // probe always fails

    await expect(command.func(page, { id, prompt: 'hi' })).rejects.toThrow(CommandExecutionError);
    expect(page.nativeType).not.toHaveBeenCalled();
  });

  it('throws when nativeType is not exposed on the page object', async () => {
    const page = createPage({ nativeType: undefined });
    page.evaluate
      .mockResolvedValueOnce(true)             // waitForTextareaReady
      .mockResolvedValueOnce(true);            // focus

    await expect(command.func(page, { id, prompt: 'hi' })).rejects.toThrow(CommandExecutionError);
  });

  it('throws when the focus probe reports the textarea did not take focus', async () => {
    const page = createPage();
    page.evaluate
      .mockResolvedValueOnce(true)             // waitForTextareaReady
      .mockResolvedValueOnce(false);           // focus failed

    await expect(command.func(page, { id, prompt: 'hi' })).rejects.toThrow(CommandExecutionError);
    expect(page.nativeType).not.toHaveBeenCalled();
  });

  it('translates the IIFE failure reason into a CommandExecutionError', async () => {
    const page = createPage();
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ok: false, reason: 'send button stayed disabled after native input' });

    await expect(command.func(page, { id, prompt: 'hi' })).rejects.toThrow(
      new CommandExecutionError('send button stayed disabled after native input'),
    );
  });

  it('treats "Promise was collected" from the IIFE as a successful submit', async () => {
    const page = createPage();
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('{"code":-32000,"message":"Promise was collected"}'));

    const rows = await command.func(page, { id, prompt: 'hi' });

    expect(rows).toEqual([{ Status: 'Success', InjectedText: 'hi' }]);
  });
});
