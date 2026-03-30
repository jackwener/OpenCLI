import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import { AuthRequiredError } from '../../errors.js';
import './question.js';

describe('zhihu question', () => {
  it('returns answers even when the unused question detail request fails', async () => {
    const cmd = getRegistry().get('zhihu/question');
    expect(cmd?.func).toBeTypeOf('function');

    const evaluate = vi.fn().mockImplementation(async (_fn: unknown, args: { questionId: string; answerLimit: number }) => {
      expect(args).toEqual({ questionId: '2021881398772981878', answerLimit: 3 });
      return {
        ok: true,
        answers: [
          {
            author: { name: 'alice' },
            voteup_count: 12,
            content: '<p>Hello <b>Zhihu</b></p>',
          },
        ],
      };
    });

    const page = {
      evaluate,
    } as any;

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

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('maps auth-like answer failures to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/question');
    expect(cmd?.func).toBeTypeOf('function');

    const page = {
      evaluate: vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('preserves non-auth fetch failures as CliError instead of login errors', async () => {
    const cmd = getRegistry().get('zhihu/question');
    expect(cmd?.func).toBeTypeOf('function');

    const page = {
      evaluate: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '2021881398772981878', limit: 3 }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'Zhihu question answers request failed with HTTP 500',
    });
  });
});
