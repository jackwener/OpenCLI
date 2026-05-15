import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const { __test__ } = await import('./memos.js');
const { command, normalizeMemo, parsePositiveIntArg, parseSinceArg, parseSlugArg } = __test__;

function createPage(token = 'token-123') {
  return {
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ session: 'browser:default', data: token }),
  };
}

function mockFetchJson(body, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }));
}

describe('flomo memos registration', () => {
  it('registers as a browser cookie read command with stable columns', () => {
    expect(command.site).toBe('flomo');
    expect(command.name).toBe('memos');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('cookie');
    expect(command.columns).toEqual(['id', 'url', 'content', 'slug', 'tags', 'images', 'created_at', 'updated_at']);
  });
});

describe('flomo memos argument validation', () => {
  it('rejects invalid limits instead of silently clamping', () => {
    expect(() => parsePositiveIntArg('0', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('201', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('10.5', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('abc', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(parsePositiveIntArg(undefined, 'limit', 20, 200)).toBe(20);
    expect(parsePositiveIntArg('200', 'limit', 20, 200)).toBe(200);
  });

  it('rejects invalid since and slug arguments', () => {
    expect(parseSinceArg(undefined)).toBe(0);
    expect(parseSinceArg('1735689600')).toBe(1735689600);
    expect(() => parseSinceArg('-1')).toThrow(ArgumentError);
    expect(() => parseSinceArg('1.5')).toThrow(ArgumentError);
    expect(parseSlugArg(undefined)).toBe('');
    expect(parseSlugArg('abc_DEF-123')).toBe('abc_DEF-123');
    expect(() => parseSlugArg('bad/slash')).toThrow(ArgumentError);
    expect(() => parseSlugArg('bad space')).toThrow(ArgumentError);
  });
});

describe('flomo memo normalization', () => {
  it('emits string-safe id/url fields and normalizes tags/images', () => {
    expect(normalizeMemo({
      slug: 'memo_12345678901234567890',
      content: ' <p>Hello</p> ',
      tags: [{ name: 'work' }, 'idea'],
      files: [{ thumbnail_url: 'https://img/thumb.jpg' }, { url: 'https://img/full.jpg' }],
      created_at: '2026-01-01T00:00:00+08:00',
      updated_at: '2026-01-02T00:00:00+08:00',
    })).toEqual({
      id: 'memo_12345678901234567890',
      url: 'https://v.flomoapp.com/mine/?memo_id=memo_12345678901234567890',
      content: '<p>Hello</p>',
      slug: 'memo_12345678901234567890',
      tags: 'work, idea',
      images: 'https://img/thumb.jpg | https://img/full.jpg',
      created_at: '2026-01-01T00:00:00+08:00',
      updated_at: '2026-01-02T00:00:00+08:00',
    });
  });

  it('fails typed on malformed memo entries', () => {
    expect(() => normalizeMemo(null)).toThrow(CommandExecutionError);
    expect(() => normalizeMemo({ content: 'missing slug' })).toThrow(CommandExecutionError);
  });
});

describe('flomo memos command', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads token from Browser Bridge envelope and returns memo rows', async () => {
    mockFetchJson({
      code: 0,
      data: [{
        slug: 'memo_1',
        content: 'hello',
        tags: ['tag'],
        files: [],
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      }],
    });

    const rows = await command.func(createPage(), { limit: '1' });

    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('limit=1'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    }));
    expect(rows).toEqual([{
      id: 'memo_1',
      url: 'https://v.flomoapp.com/mine/?memo_id=memo_1',
      content: 'hello',
      slug: 'memo_1',
      tags: 'tag',
      images: '',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);
  });

  it('throws AuthRequiredError when the browser session has no token', async () => {
    await expect(command.func(createPage(null), {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps Flomo auth failures to AuthRequiredError', async () => {
    mockFetchJson({ code: 401, message: 'unauthorized' });
    await expect(command.func(createPage(), {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps HTTP, malformed JSON, malformed data, and empty results to typed errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: vi.fn() }));
    await expect(command.func(createPage(), {})).rejects.toBeInstanceOf(CommandExecutionError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new Error('bad json')) }));
    await expect(command.func(createPage(), {})).rejects.toBeInstanceOf(CommandExecutionError);

    mockFetchJson({ code: 0, data: {} });
    await expect(command.func(createPage(), {})).rejects.toBeInstanceOf(CommandExecutionError);

    mockFetchJson({ code: 0, data: [] });
    await expect(command.func(createPage(), {})).rejects.toBeInstanceOf(EmptyResultError);
  });
});
