import { describe, expect, it, vi } from 'vitest';
import { CliError } from '../errors.js';
import { BasePage } from './base-page.js';

class TestPage extends BasePage {
  result: unknown;
  args: Record<string, unknown> | undefined;

  async goto(): Promise<void> {}
  async evaluate(): Promise<unknown> { return null; }
  override async evaluateWithArgs(_js: string, args: Record<string, unknown>): Promise<unknown> {
    this.args = args;
    return this.result;
  }
  async getCookies(): Promise<[]> { return []; }
  async screenshot(): Promise<string> { return ''; }
  async tabs(): Promise<unknown[]> { return []; }
  async selectTab(): Promise<void> {}
}

class ActionPage extends BasePage {
  results: unknown[] = [];
  scripts: string[] = [];
  nativeType?: (text: string) => Promise<void>;
  insertText?: (text: string) => Promise<void>;
  nativeKeyPress?: (key: string, modifiers?: string[]) => Promise<void>;

  async goto(): Promise<void> {}
  async evaluate(js: string): Promise<unknown> {
    this.scripts.push(js);
    return this.results.shift() ?? null;
  }
  async getCookies(): Promise<[]> { return []; }
  async screenshot(): Promise<string> { return ''; }
  async tabs(): Promise<unknown[]> { return []; }
  async selectTab(): Promise<void> {}
}

const resolveOk = { ok: true, matches_n: 1, match_level: 'exact' };

describe('BasePage.fetchJson', () => {
  it('passes a narrow browser-context JSON request and parses the response in Node', async () => {
    const page = new TestPage();
    page.result = {
      ok: true,
      status: 200,
      url: 'https://api.example.com/items',
      contentType: 'application/json',
      text: '{"items":[1]}',
    };

    await expect(page.fetchJson('https://api.example.com/items', {
      method: 'POST',
      headers: { 'X-Test': '1' },
      body: { q: 'opencli' },
      timeoutMs: 1234,
    })).resolves.toEqual({ items: [1] });

    expect(page.args).toEqual({
      request: {
        url: 'https://api.example.com/items',
        method: 'POST',
        headers: { 'X-Test': '1' },
        body: { q: 'opencli' },
        hasBody: true,
        timeoutMs: 1234,
      },
    });
  });

  it('throws a CliError for non-JSON responses', async () => {
    const page = new TestPage();
    page.result = {
      ok: true,
      status: 200,
      url: 'https://api.example.com/items',
      contentType: 'text/html',
      text: '<html>blocked</html>',
    };

    const err = await page.fetchJson('https://api.example.com/items').catch((error: unknown) => error);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('FETCH_ERROR');
    expect((err as CliError).message).toContain('Expected JSON');
    expect((err as CliError).hint).toContain('blocked');
  });

  it('throws a CliError for browser fetch transport errors', async () => {
    const page = new TestPage();
    page.result = {
      ok: false,
      status: 0,
      url: 'https://api.example.com/items',
      text: '',
      error: 'The operation was aborted.',
    };

    await expect(page.fetchJson('https://api.example.com/items')).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: expect.stringContaining('The operation was aborted.'),
    });
  });
});

describe('BasePage native input routing', () => {
  it('types rich-editor text via native Input.insertText when available', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockResolvedValue(undefined);
    page.results = [resolveOk, { ok: true, mode: 'contenteditable' }];

    await expect(page.typeText('#editor', 'hello')).resolves.toEqual({ matches_n: 1, match_level: 'exact' });

    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts).toHaveLength(2);
    expect(page.scripts[1]).toContain('nearestContentEditableHost');
    expect(page.scripts.join('\n')).not.toContain("return 'typed'");
  });

  it('keeps the DOM setter fallback when native text insertion is unavailable', async () => {
    const page = new ActionPage();
    page.results = [resolveOk, 'typed'];

    await page.typeText('#q', 'hello');

    expect(page.scripts).toHaveLength(2);
    expect(page.scripts[1]).toContain('document.execCommand');
    expect(page.scripts[1]).toContain("return 'typed'");
  });

  it('falls back to DOM typing if native text insertion fails', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockRejectedValue(new Error('native failed'));
    page.results = [resolveOk, { ok: true, mode: 'input' }, 'typed'];

    await page.typeText('#q', 'hello');

    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts).toHaveLength(3);
    expect(page.scripts[2]).toContain("return 'typed'");
  });

  it('presses key chords through native CDP key events when available', async () => {
    const page = new ActionPage();
    page.nativeKeyPress = vi.fn().mockResolvedValue(undefined);

    await page.pressKey('Control+a');

    expect(page.nativeKeyPress).toHaveBeenCalledWith('a', ['Ctrl']);
    expect(page.scripts).toHaveLength(0);
  });

  it('falls back to synthetic keyboard events with parsed modifiers', async () => {
    const page = new ActionPage();

    await page.pressKey('Meta+N');

    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]).toContain('key: "N"');
    expect(page.scripts[0]).toContain('metaKey: true');
  });
});
