import { afterEach, describe, expect, it, vi } from 'vitest';
import { CDPBridge } from './browser/cdp.js';
import { getBrowserFactory } from './runtime.js';

describe('getBrowserFactory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('routes website CLIs over CDP when OPENCLI_CDP_ENDPOINT is set', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');
    expect(getBrowserFactory('twitter')).toBe(CDPBridge);
  });
});
