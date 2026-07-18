import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridge, CDPBridge } from './browser/index.js';
import { getBrowserFactory } from './runtime.js';

describe('getBrowserFactory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses BrowserBridge for regular sites by default', () => {
    expect(getBrowserFactory('xianyu')).toBe(BrowserBridge);
  });

  it('uses CDPBridge when OPENCLI_CDP_ENDPOINT is configured', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9333');

    expect(getBrowserFactory('xianyu')).toBe(CDPBridge);
  });
});
