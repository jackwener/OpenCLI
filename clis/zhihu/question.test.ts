import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../src/registry.js';
import { AuthRequiredError, CliError } from '../../src/errors.js';
import './question.js';

describe('zhihu question', () => {
  it('returns answers from the Zhihu API', async () => {
    const cmd = getRegistry().get('zhihu/question');
    expect(cmd?.func).toBeTypeOf('function');

    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (js: string) => {
      expect(js).toContain('questions/2021881398772981878/answers?limit=3');
      expect(js).toContain("credentials: 'include'");
      return {
        data: [
          {
            author: { name: 'alice' },
            voteup_count: 12,
            content: 'Hello Zhihu',
          },
        ],
      };
    });

    const page = { goto, evaluate } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).resolves.toEqual([
      {
        rank: 1,
        author: 'alice',
        votes: 12,
        content: 'Hello Zhihu',
      },
    ]);

    expect(goto).toHaveBeenCalledWith('https://www.zhihu.com/question/2021881398772981878');
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('maps auth-like answer failures to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/question');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('preserves non-auth fetch failures as CliError', async () => {
    const cmd = getRegistry().get('zhihu/question');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'Zhihu question answers request failed (HTTP 500)',
    });
  });

  it('handles null evaluate response as fetch error', async () => {
    const cmd = getRegistry().get('zhihu/question');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'Zhihu question answers request failed',
    });
  });

  it('rejects non-numeric question IDs', async () => {
    const cmd = getRegistry().get('zhihu/question');
    const page = { goto: vi.fn(), evaluate: vi.fn() } as any;

    await expect(
      cmd!.func!(page, { id: "abc'; alert(1); //", limit: 1 }),
    ).rejects.toBeInstanceOf(CliError);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
