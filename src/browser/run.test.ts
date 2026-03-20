import { describe, expect, it } from 'vitest';
import { buildBrowserRunEnv, extractPassthroughArgs } from './run.js';

describe('browser run helpers', () => {
  it('extracts passthrough arguments after --', () => {
    const args = extractPassthroughArgs([
      'node',
      'dist/main.js',
      'browser',
      'run',
      '--backend',
      'cdp',
      '--',
      'zhihu',
      'search',
      '--keyword',
      'AI',
    ]);

    expect(args).toEqual(['zhihu', 'search', '--keyword', 'AI']);
  });

  it('returns empty args when no separator is present', () => {
    expect(extractPassthroughArgs(['node', 'dist/main.js', 'browser', 'run'])).toEqual([]);
  });

  it('builds runtime env overrides', () => {
    const env = buildBrowserRunEnv({
      backend: 'cdp',
      cdpEndpoint: 'http://127.0.0.1:9222',
      cdpTarget: 'chatgpt.com',
      env: {},
    });

    expect(env.OPENCLI_BROWSER_MODE).toBe('cdp');
    expect(env.OPENCLI_CDP_ENDPOINT).toBe('http://127.0.0.1:9222');
    expect(env.OPENCLI_CDP_TARGET).toBe('chatgpt.com');
  });
});
