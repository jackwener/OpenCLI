import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const { __test__ } = await import('./search.js');
const command = __test__.command;

function createPageMock(evaluateResult = []) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
}

describe('duckduckgo search', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('duckduckgo');
    expect(command.name).toBe('search');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('html.duckduckgo.com');
  });

  it('should define keyword positional arg', () => {
    const kwArg = command.args.find(a => a.name === 'keyword');
    expect(kwArg).toBeDefined();
    expect(kwArg.positional).toBe(true);
    expect(kwArg.required).toBe(true);
  });

  it('should define limit arg with default 10', () => {
    const limitArg = command.args.find(a => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg.type).toBe('int');
    expect(limitArg.default).toBe(10);
  });

  it('should define columns for output', () => {
    expect(command.columns).toContain('rank');
    expect(command.columns).toContain('title');
    expect(command.columns).toContain('url');
    expect(command.columns).toContain('snippet');
    expect(command.columns).toContain('displayUrl');
    expect(command.columns).toContain('icon');
    expect(command.columns).toContain('resultType');
  });

  it('rejects empty query and out-of-range pagination before navigation', async () => {
    const page = createPageMock();
    await expect(command.func(page, { keyword: ' ', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'opencli', limit: 11 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'opencli', limit: 5, offset: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('decodes DuckDuckGo redirect URLs and assigns listing rank', async () => {
    const page = createPageMock([
      [
        'OpenCLI',
        '/l/?uddg=https%3A%2F%2Fgithub.com%2Fjackwener%2FOpenCLI',
        'CLI browser tooling',
        'github.com/jackwener/OpenCLI',
        '',
        'web',
      ],
    ]);

    await expect(command.func(page, { keyword: 'opencli', limit: 1 })).resolves.toEqual([{
      rank: 1,
      title: 'OpenCLI',
      url: 'https://github.com/jackwener/OpenCLI',
      snippet: 'CLI browser tooling',
      displayUrl: 'github.com/jackwener/OpenCLI',
      icon: '',
      resultType: 'web',
    }]);
  });

  it('executes the DOM extractor, filters ads, and returns canonical rows', async () => {
    const dom = new JSDOM(`
      <div class="result result--ad">
        <a class="result__a" href="https://ads.example/">Sponsored result</a>
      </div>
      <div class="result">
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">Organic result</a>
        <a class="result__snippet">Organic snippet</a>
        <span class="result__url">example.com/article</span>
        <img class="result__icon__img" src="https://icons.duckduckgo.com/ip3/example.com.ico">
      </div>
    `);
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (source) => Function('document', `return ${source};`)(dom.window.document)),
    };

    await expect(command.func(page, { keyword: 'opencli', limit: 5 })).resolves.toEqual([{
      rank: 1,
      title: 'Organic result',
      url: 'https://example.com/article',
      snippet: 'Organic snippet',
      displayUrl: 'example.com/article',
      icon: 'https://icons.duckduckgo.com/ip3/example.com.ico',
      resultType: 'web',
    }]);
  });

  it('unwraps browser envelopes for paginated extraction', async () => {
    const page = createPageMock({ session: 'site:duckduckgo', data: [
      ['Result', 'https://example.com/', 'snippet', 'example.com', '', 'web'],
    ] });

    const result = await command.func(page, { keyword: 'opencli', limit: 1, offset: 10 });

    expect(result[0]).toMatchObject({ rank: 11, url: 'https://example.com/' });
  });

  it('fails typed instead of returning [] for malformed extraction payloads', async () => {
    const page = createPageMock({ rows: [] });

    await expect(command.func(page, { keyword: 'opencli', limit: 1 })).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
      message: expect.stringContaining('payload shape'),
    });
  });
});
