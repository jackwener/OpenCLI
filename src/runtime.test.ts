import { afterEach, describe, expect, it } from 'vitest';
import { BrowserBridge, CDPBridge } from './browser/index.js';
import { getBrowserFactory, getConfiguredCdpEndpoint } from './runtime.js';

describe('getConfiguredCdpEndpoint / getBrowserFactory', () => {
  afterEach(() => {
    delete process.env.OPENCLI_CDP_ENDPOINT;
  });

  it('treats missing or blank OPENCLI_CDP_ENDPOINT as unset', () => {
    delete process.env.OPENCLI_CDP_ENDPOINT;
    expect(getConfiguredCdpEndpoint()).toBeUndefined();
    process.env.OPENCLI_CDP_ENDPOINT = '   ';
    expect(getConfiguredCdpEndpoint()).toBeUndefined();
  });

  it('returns trimmed OPENCLI_CDP_ENDPOINT when set', () => {
    process.env.OPENCLI_CDP_ENDPOINT = '  http://127.0.0.1:9222  ';
    expect(getConfiguredCdpEndpoint()).toBe('http://127.0.0.1:9222');
  });

  it('routes website sites through BrowserBridge by default', () => {
    expect(getBrowserFactory('bilibili')).toBe(BrowserBridge);
    expect(getBrowserFactory()).toBe(BrowserBridge);
  });

  it('routes Electron sites through CDPBridge', () => {
    expect(getBrowserFactory('cursor')).toBe(CDPBridge);
  });

  it('routes any site through CDPBridge when OPENCLI_CDP_ENDPOINT is set', () => {
    process.env.OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9222';
    expect(getBrowserFactory('bilibili')).toBe(CDPBridge);
    expect(getBrowserFactory('zhihu')).toBe(CDPBridge);
    expect(getBrowserFactory()).toBe(CDPBridge);
  });
});
