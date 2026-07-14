import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserBridge, CDPBridge } from './browser/index.js';
import { getBrowserFactory } from './runtime.js';

describe('runtime browser factory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses CDPBridge when OPENCLI_CDP_ENDPOINT is configured', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');

    expect(getBrowserFactory('douban')).toBe(CDPBridge);
  });

  it('uses CDPBridge for registered Electron apps', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', '');

    expect(getBrowserFactory('cursor')).toBe(CDPBridge);
  });

  it('uses BrowserBridge for browser-backed sites by default', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', '');

    expect(getBrowserFactory('douban')).toBe(BrowserBridge);
  });
});
