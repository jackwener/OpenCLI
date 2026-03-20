import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrowserRuntimeOptions, getBrowserFactory, normalizeBrowserMode, resolveBrowserBackend } from './backend.js';
import { BrowserBridge } from './mcp.js';
import { CDPBridge } from './cdp.js';

describe('browser backend resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OPENCLI_BROWSER_MODE;
    delete process.env.OPENCLI_CDP_ENDPOINT;
    delete process.env.OPENCLI_CDP_TARGET;
  });

  it('defaults to auto mode', () => {
    expect(normalizeBrowserMode()).toBe('auto');
  });

  it('rejects unsupported modes', () => {
    expect(() => normalizeBrowserMode('bad')).toThrow('Unsupported browser mode');
  });

  it('resolves to extension mode when no endpoint is configured', () => {
    expect(resolveBrowserBackend()).toMatchObject({ requestedMode: 'auto', mode: 'extension' });
    expect(getBrowserFactory()).toBe(BrowserBridge);
  });

  it('resolves to cdp mode when endpoint is configured', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');

    expect(resolveBrowserBackend()).toMatchObject({ requestedMode: 'auto', mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' });
    expect(getBrowserFactory()).toBe(CDPBridge);
  });

  it('respects explicit runtime options', () => {
    applyBrowserRuntimeOptions({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9333', cdpTarget: 'codex' });

    expect(process.env.OPENCLI_BROWSER_MODE).toBe('cdp');
    expect(process.env.OPENCLI_CDP_ENDPOINT).toBe('http://127.0.0.1:9333');
    expect(process.env.OPENCLI_CDP_TARGET).toBe('codex');
  });

  it('requires endpoint when cdp mode is forced', () => {
    expect(() => getBrowserFactory('cdp')).toThrow('CDP mode requires a reachable endpoint');
  });
});
