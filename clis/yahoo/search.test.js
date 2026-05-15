import { describe, it, expect, vi } from 'vitest';

const { __test__ } = await import('./search.js');
const command = __test__.command;

function createPageMock(evaluateResult = []) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
}

describe('yahoo search', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('yahoo');
    expect(command.name).toBe('search');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('search.yahoo.com');
  });

  it('should define keyword positional arg', () => {
    const kwArg = command.args.find(a => a.name === 'keyword');
    expect(kwArg).toBeDefined();
    expect(kwArg.positional).toBe(true);
    expect(kwArg.required).toBe(true);
  });

  it('should define limit arg with default 7', () => {
    const limitArg = command.args.find(a => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg.type).toBe('int');
    expect(limitArg.default).toBe(7);
  });

  it('should define output columns', () => {
    expect(command.columns).toContain('rank');
    expect(command.columns).toContain('title');
    expect(command.columns).toContain('url');
    expect(command.columns).toContain('snippet');
  });

  it('rejects empty query, invalid limit, and invalid page before navigation', async () => {
    const page = createPageMock();
    await expect(command.func(page, { keyword: ' ', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'opencli', limit: 8 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'opencli', limit: 5, page: 0 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('decodes Yahoo redirect URLs and assigns listing rank', async () => {
    const page = createPageMock({
      session: 'site:yahoo',
      data: [[
        'OpenCLI',
        'https://r.search.yahoo.com/_ylt=x/RU=https%3A%2F%2Fgithub.com%2Fjackwener%2FOpenCLI/RK=2/RS=x',
        'CLI browser tooling',
      ]],
    });

    await expect(command.func(page, { keyword: 'opencli', limit: 1, page: 2 })).resolves.toEqual([{
      rank: 8,
      title: 'OpenCLI',
      url: 'https://github.com/jackwener/OpenCLI',
      snippet: 'CLI browser tooling',
    }]);
  });

  it('drops decoded Yahoo redirect targets that are not http(s) URLs', async () => {
    const page = createPageMock([
      [
        'Bad redirect',
        'https://r.search.yahoo.com/_ylt=x/RU=javascript%3Aalert(1)/RK=2/RS=x',
        'should not be emitted',
      ],
    ]);

    await expect(command.func(page, { keyword: 'opencli', limit: 1 })).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
    });
  });

  it('fails typed instead of silently returning [] for malformed extraction payloads', async () => {
    const page = createPageMock({ rows: [] });

    await expect(command.func(page, { keyword: 'opencli', limit: 1 })).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
      message: expect.stringContaining('payload shape'),
    });
  });
});
