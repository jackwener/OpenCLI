import { describe, expect, it, vi } from 'vitest';

import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './delete.js';
import './delete.js';

describe('twitter delete command', () => {
  it('extracts tweet ids from both user and i/status URLs', () => {
    expect(__test__.extractTweetId('https://x.com/alice/status/2040254679301718161?s=20')).toBe('2040254679301718161');
    expect(__test__.extractTweetId('https://x.com/i/status/2040318731105313143')).toBe('2040318731105313143');
  });

  it('targets the matched tweet article instead of the first More button on the page', async () => {
    const cmd = getRegistry().get('twitter/delete');
    expect(cmd?.func).toBeTypeOf('function');

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ok: true, message: 'Tweet successfully deleted.' }),
    };

    const result = await cmd!.func!(page as any, {
      url: 'https://x.com/alice/status/2040254679301718161?s=20',
    });

    expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161?s=20');
    expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
    expect(page.wait).toHaveBeenNthCalledWith(2, 2);

    const script = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(script).toContain("document.querySelectorAll('article')");
    expect(script).toContain("'/status/' + tweetId");
    expect(script).toContain("targetArticle.querySelectorAll('button,[role=\"button\"]')");

    expect(result).toEqual([
      {
        status: 'success',
        message: 'Tweet successfully deleted.',
      },
    ]);
  });

  it('passes through matched-tweet lookup failures', async () => {
    const cmd = getRegistry().get('twitter/delete');
    expect(cmd?.func).toBeTypeOf('function');

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        ok: false,
        message: 'Could not find the tweet card matching the requested URL.',
      }),
    };

    const result = await cmd!.func!(page as any, {
      url: 'https://x.com/alice/status/2040254679301718161',
    });

    expect(result).toEqual([
      {
        status: 'failed',
        message: 'Could not find the tweet card matching the requested URL.',
      },
    ]);
    expect(page.wait).toHaveBeenCalledTimes(1);
  });

  it('normalizes invalid tweet URLs into CommandExecutionError', async () => {
    const cmd = getRegistry().get('twitter/delete');
    expect(cmd?.func).toBeTypeOf('function');

    const page = {
      goto: vi.fn(),
      wait: vi.fn(),
      evaluate: vi.fn(),
    };

    await expect(
      cmd!.func!(page as any, {
        url: 'https://x.com/alice/home',
      }),
    ).rejects.toThrow(CommandExecutionError);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.wait).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
