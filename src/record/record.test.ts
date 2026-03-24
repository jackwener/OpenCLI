/**
 * Tests for the record module — pure function logic only (no browser needed).
 *
 * Covers: URL patterns, auth detection, array finding, capability inference,
 * strategy inference, request scoring, interceptor JS generation, YAML generation.
 */

import { describe, it, expect } from 'vitest';
import { urlToPattern, detectAuthIndicators, findArrayPath, inferCapabilityName, inferStrategy, scoreRequest } from './analysis.js';
import { generateFullCaptureInterceptorJs, generateReadRecordedJs } from './interceptor.js';
import { buildRecordedYaml } from './generator.js';
import type { RecordedRequest } from './types.js';

// ── analysis.ts ────────────────────────────────────────────────────────────

describe('urlToPattern (record)', () => {
  it('replaces numeric path segments with {id}', () => {
    expect(urlToPattern('https://api.example.com/video/12345')).toBe('api.example.com/video/{id}');
  });

  it('replaces hex IDs with {hex}', () => {
    expect(urlToPattern('https://api.example.com/item/abcdef1234567890')).toBe('api.example.com/item/{hex}');
  });

  it('replaces BV IDs with {bvid}', () => {
    expect(urlToPattern('https://www.bilibili.com/video/BV1aB4y1c7E1')).toBe('www.bilibili.com/video/{bvid}');
  });

  it('strips volatile query params', () => {
    const url = 'https://api.example.com/data?q=test&w_rid=abc&limit=10';
    const pattern = urlToPattern(url);
    expect(pattern).toContain('limit={}');
    expect(pattern).toContain('q={}');
    expect(pattern).not.toContain('w_rid');
  });

  it('returns raw URL for invalid input', () => {
    expect(urlToPattern('not-a-url')).toBe('not-a-url');
  });
});

describe('detectAuthIndicators (record)', () => {
  it('detects signature from body fields', () => {
    const body = { data: [], w_rid: 'xxx', sign: 'abc' };
    expect(detectAuthIndicators('https://api.example.com/data', body)).toContain('signature');
  });

  it('detects signature from URL pattern', () => {
    expect(detectAuthIndicators('https://api.bilibili.com/wbi/search', {})).toContain('signature');
    expect(detectAuthIndicators('https://api.example.com/data?w_rid=abc', {})).toContain('signature');
  });

  it('detects bearer from URL', () => {
    expect(detectAuthIndicators('https://api.example.com/data?access_token=xyz', {})).toContain('bearer');
  });

  it('returns empty for clean URLs and bodies', () => {
    expect(detectAuthIndicators('https://api.example.com/data', { items: [] })).toEqual([]);
  });
});

describe('findArrayPath', () => {
  it('finds root-level array', () => {
    const data = [
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
    ];
    const result = findArrayPath(data);
    expect(result).not.toBeNull();
    expect(result!.path).toBe('');
    expect(result!.items).toHaveLength(2);
  });

  it('finds nested array', () => {
    const data = {
      code: 0,
      data: {
        list: [
          { title: 'A' },
          { title: 'B' },
          { title: 'C' },
        ],
      },
    };
    const result = findArrayPath(data);
    expect(result).not.toBeNull();
    expect(result!.path).toBe('data.list');
    expect(result!.items).toHaveLength(3);
  });

  it('returns null for non-object', () => {
    expect(findArrayPath(null)).toBeNull();
    expect(findArrayPath('string')).toBeNull();
  });

  it('returns null for arrays of primitives', () => {
    expect(findArrayPath({ tags: ['a', 'b', 'c'] })).toBeNull();
  });

  it('prefers larger arrays', () => {
    const data = {
      small: [{ a: 1 }, { a: 2 }],
      large: [{ b: 1 }, { b: 2 }, { b: 3 }, { b: 4 }],
    };
    const result = findArrayPath(data);
    expect(result!.path).toBe('large');
    expect(result!.items).toHaveLength(4);
  });
});

describe('inferCapabilityName (record)', () => {
  it('detects hot/trending', () => {
    expect(inferCapabilityName('https://api.example.com/hot')).toBe('hot');
    expect(inferCapabilityName('https://api.example.com/trending')).toBe('hot');
  });

  it('detects search', () => {
    expect(inferCapabilityName('https://api.example.com/search?q=test')).toBe('search');
  });

  it('detects feed/timeline', () => {
    expect(inferCapabilityName('https://api.example.com/feed')).toBe('feed');
  });

  it('detects comments', () => {
    expect(inferCapabilityName('https://api.example.com/comment/list')).toBe('comments');
  });

  it('filters out version segments', () => {
    // Use a URL without keywords like 'me', 'hot', 'search' etc. embedded
    expect(inferCapabilityName('https://api.example.com/v1/articles')).toBe('articles');
  });

  it('returns "data" for bare URLs', () => {
    expect(inferCapabilityName('https://api.example.com/')).toBe('data');
  });
});

describe('inferStrategy (record)', () => {
  it('returns intercept for signature', () => {
    expect(inferStrategy(['signature'])).toBe('intercept');
  });

  it('returns header for bearer', () => {
    expect(inferStrategy(['bearer'])).toBe('header');
  });

  it('returns cookie as default', () => {
    expect(inferStrategy([])).toBe('cookie');
  });
});

describe('scoreRequest', () => {
  const makeReq = (url = 'https://api.example.com/data'): RecordedRequest => ({
    url,
    method: 'GET',
    status: 200,
    contentType: 'application/json',
    body: null,
    capturedAt: Date.now(),
  });

  it('gives high score when array result has many items', () => {
    const arrayResult = { path: 'data.list', items: Array(10).fill({ title: 'test' }) };
    expect(scoreRequest(makeReq(), arrayResult)).toBeGreaterThanOrEqual(20);
  });

  it('gives zero score for null array result and non-API url', () => {
    expect(scoreRequest(makeReq('https://example.com/page'), null)).toBe(0);
  });

  it('gives bonus for /api/ URLs', () => {
    const noApi = scoreRequest(makeReq('https://example.com/data'), null);
    const withApi = scoreRequest(makeReq('https://example.com/api/data'), null);
    expect(withApi).toBeGreaterThan(noApi);
  });

  it('penalizes tracking endpoints', () => {
    const normal = scoreRequest(makeReq('https://example.com/api/data'), null);
    const tracking = scoreRequest(makeReq('https://example.com/api/track'), null);
    expect(tracking).toBeLessThan(normal);
  });

  it('penalizes heartbeat endpoints', () => {
    const score = scoreRequest(makeReq('https://example.com/api/heartbeat'), null);
    expect(score).toBeLessThan(0);
  });
});

// ── interceptor.ts ─────────────────────────────────────────────────────────

describe('interceptor JS generation', () => {
  it('generates non-empty interceptor script', () => {
    const js = generateFullCaptureInterceptorJs();
    expect(js.length).toBeGreaterThan(100);
  });

  it('contains fetch and XHR patching', () => {
    const js = generateFullCaptureInterceptorJs();
    expect(js).toContain('window.fetch');
    expect(js).toContain('XMLHttpRequest');
  });

  it('includes idempotent guard', () => {
    const js = generateFullCaptureInterceptorJs();
    expect(js).toContain('__opencli_record_patched');
  });

  it('generates non-empty read script', () => {
    const js = generateReadRecordedJs();
    expect(js.length).toBeGreaterThan(10);
    expect(js).toContain('__opencli_record');
  });
});

// ── generator.ts ───────────────────────────────────────────────────────────

describe('buildRecordedYaml', () => {
  const makeReq = (url: string): RecordedRequest => ({
    url,
    method: 'GET',
    status: 200,
    contentType: 'application/json',
    body: null,
    capturedAt: Date.now(),
  });

  it('generates valid YAML candidate', () => {
    const arrayResult = {
      path: 'data.list',
      items: [
        { title: 'Item 1', url: 'https://example.com/1', score: 42 },
        { title: 'Item 2', url: 'https://example.com/2', score: 10 },
      ],
    };
    const result = buildRecordedYaml(
      'example',
      'https://www.example.com',
      makeReq('https://api.example.com/hot'),
      'hot',
      arrayResult,
      [],
    );
    expect(result.name).toBe('hot');
    const yml = result.yaml as Record<string, unknown>;
    expect(yml.site).toBe('example');
    expect(yml.name).toBe('hot');
    expect(yml.browser).toBe(true);
    expect(yml.strategy).toBe('cookie');
    expect(yml.columns).toContain('rank');
    expect(yml.columns).toContain('title');
    expect(yml.columns).toContain('url');
    expect(yml.columns).toContain('score');
  });

  it('uses intercept strategy for signature auth', () => {
    const arrayResult = { path: 'data', items: [{ a: 1 }, { a: 2 }] };
    const result = buildRecordedYaml(
      'test', 'https://test.com', makeReq('https://api.test.com/data'), 'data', arrayResult, ['signature'],
    );
    expect((result.yaml as Record<string, unknown>).strategy).toBe('intercept');
  });

  it('adds search arg when query param detected', () => {
    const arrayResult = { path: 'data', items: [{ a: 1 }, { a: 2 }] };
    const result = buildRecordedYaml(
      'test', 'https://test.com', makeReq('https://api.test.com/search?q=hello&limit=10'), 'search', arrayResult, [],
    );
    const args = (result.yaml as Record<string, unknown>).args as Record<string, unknown>;
    expect(args).toHaveProperty('keyword');
    expect(args).toHaveProperty('limit');
  });

  it('defaults to title+url columns when no fields detected', () => {
    const arrayResult = { path: 'data', items: [{ x: 1 }, { x: 2 }] };
    const result = buildRecordedYaml(
      'test', 'https://test.com', makeReq('https://api.test.com/data'), 'data', arrayResult, [],
    );
    const cols = (result.yaml as Record<string, unknown>).columns as string[];
    expect(cols).toContain('rank');
    expect(cols).toContain('title');
    expect(cols).toContain('url');
  });
});
