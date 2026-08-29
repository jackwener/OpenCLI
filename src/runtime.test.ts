import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBrowserFactory } from './runtime.js';
import { CDPBridge } from './browser/cdp.js';
import { BrowserBridge } from './browser/bridge.js';

describe('getBrowserFactory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes website CLIs through the Browser Bridge extension by default', () => {
    expect(getBrowserFactory('twitter')).toBe(BrowserBridge);
  });

  it('routes website CLIs over CDP when OPENCLI_CDP_ENDPOINT is set (remote-Chrome mode)', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');
    expect(getBrowserFactory('twitter')).toBe(CDPBridge);
  });
});
