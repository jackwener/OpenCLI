import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    statSync: vi.fn((p) => {
      if (String(p).includes('missing')) return undefined;
      return { isFile: () => !String(p).includes('directory') };
    }),
  };
});

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolve: vi.fn((p) => `/abs/${p}`),
    extname: vi.fn((p) => {
      const m = String(p).match(/\.[^.]+$/);
      return m ? m[0] : '';
    }),
  };
});

import './publish.js';

function makePage({ evaluateResults = [], evaluateWithArgsResults = [], overrides = {} } = {}) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }
  evaluate.mockResolvedValue({ ok: true });

  const evaluateWithArgs = vi.fn();
  for (const result of evaluateWithArgsResults) {
    evaluateWithArgs.mockResolvedValueOnce(result);
  }
  evaluateWithArgs.mockResolvedValue(null);

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate,
    evaluateWithArgs,
    setFileInput: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('weibo publish command', () => {
  const getCommand = () => getRegistry().get('weibo/publish');

  it('publishes a text-only post when the UI reports success', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: [
        '123456',
        { ok: true },
        { found: true, visible: true, rectTop: 100 },
        { ok: true, label: '发送' },
      ],
      evaluateWithArgsResults: [
        { ok: true, valueLength: 5 },
        { ok: true, message: '发送成功' },
      ],
    });

    const result = await command.func(page, { text: 'hello', execute: true });

    expect(result).toEqual([{ status: 'success', message: '发送成功', text: 'hello' }]);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com', { waitUntil: 'load', settleMs: 2000 });
  });

  it('uploads up to nine images before publishing', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: [
        '123456',
        { ok: true },
        { found: true, visible: true, rectTop: 100 },
        true,
        { ok: true, label: '发送' },
      ],
      evaluateWithArgsResults: [
        { ok: true, count: 2 },
        { ok: true, valueLength: 11 },
        { ok: true, message: '发送成功' },
      ],
    });

    await command.func(page, { text: 'with images', images: 'a.png,b.webp', execute: true });

    expect(page.setFileInput).toHaveBeenCalledWith(
      ['/abs/a.png', '/abs/b.webp'],
      'input[type="file"][class*="_file_"]',
    );
  });

  it('maps auth failures to AuthRequiredError', async () => {
    const command = getCommand();
    const page = makePage({ evaluateResults: [null, null] });

    await expect(command.func(page, { text: 'hello', execute: true })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('requires explicit --execute after validating arguments and before navigation', async () => {
    const command = getCommand();
    const page = makePage();

    await expect(command.func(page, { text: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { text: 'hi', images: 'a.bmp' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { text: 'hi', images: 'missing.png' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { text: 'hi', images: '1.png,2.png,3.png,4.png,5.png,6.png,7.png,8.png,9.png,10.png' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { text: 'hi' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws CommandExecutionError when compose cannot be opened', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: ['123456', { ok: false, message: 'Could not find 发微博 button' }],
    });

    await expect(command.func(page, { text: 'hello', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('throws CommandExecutionError when upload readiness is not proven', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: [
        '123456',
        { ok: true },
        { found: true, visible: true, rectTop: 100 },
        true,
      ],
      evaluateWithArgsResults: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    });

    await expect(command.func(page, { text: 'hello', images: 'a.png', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('throws CommandExecutionError when publish result is unclear or failed', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: [
        '123456',
        { ok: true },
        { found: true, visible: true, rectTop: 100 },
        { ok: true, label: '发送' },
      ],
      evaluateWithArgsResults: [
        { ok: true, valueLength: 5 },
        { ok: false, message: '内容违规' },
      ],
    });

    await expect(command.func(page, { text: 'hello', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('does not treat editor close as positive publish proof', async () => {
    const command = getCommand();
    const page = makePage({
      evaluateResults: [
        '123456',
        { ok: true },
        { found: true, visible: true, rectTop: 100 },
        { ok: true, label: '发送' },
      ],
      evaluateWithArgsResults: [
        { ok: true, valueLength: 5 },
        null,
      ],
    });

    await expect(command.func(page, { text: 'hello', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);

    const submitScript = page.evaluateWithArgs.mock.calls.at(-1)[0];
    expect(submitScript).not.toContain('Editor closed after publish');
    expect(submitScript).toContain('发布成功');
  });
});
