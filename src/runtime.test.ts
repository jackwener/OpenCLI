import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridge, CDPBridge } from './browser/index.js';
import { getBrowserFactory } from './runtime.js';

describe('getBrowserFactory', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses BrowserBridge by default for non-Electron sites', () => {
    expect(getBrowserFactory()).toBe(BrowserBridge);
    expect(getBrowserFactory('bilibili')).toBe(BrowserBridge);
  });

  it('uses CDPBridge for registered Electron apps', () => {
    expect(getBrowserFactory('cursor')).toBe(CDPBridge);
  });

  it('prefers CDPBridge whenever OPENCLI_CDP_ENDPOINT is set, including zero-arg callers', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');

    expect(getBrowserFactory()).toBe(CDPBridge);
    expect(getBrowserFactory('bilibili')).toBe(CDPBridge);
    expect(getBrowserFactory('cursor')).toBe(CDPBridge);
  });
});
