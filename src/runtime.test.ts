import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getBrowserFactory, browserSession } from './runtime.js';
import { BrowserBridge, CDPBridge } from './browser/index.js';

describe('getBrowserFactory', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OPENCLI_CDP_ENDPOINT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OPENCLI_CDP_ENDPOINT;
  });

  it('returns CDPBridge when cdpEndpoint argument is provided', () => {
    const Factory = getBrowserFactory('youtube', 'http://127.0.0.1:9222');
    expect(Factory).toBe(CDPBridge);
  });

  it('returns CDPBridge when OPENCLI_CDP_ENDPOINT env var is set', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');
    const Factory = getBrowserFactory('youtube');
    expect(Factory).toBe(CDPBridge);
  });

  it('returns CDPBridge for registered Electron apps', () => {
    const Factory = getBrowserFactory('codex');
    expect(Factory).toBe(CDPBridge);
  });

  it('returns BrowserBridge for non-Electron sites without CDP endpoint', () => {
    const Factory = getBrowserFactory('youtube');
    expect(Factory).toBe(BrowserBridge);
  });

  it('returns BrowserBridge when no site and no CDP endpoint', () => {
    const Factory = getBrowserFactory();
    expect(Factory).toBe(BrowserBridge);
  });

  it('prioritizes cdpEndpoint argument over env var', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');
    const Factory = getBrowserFactory('youtube', 'http://127.0.0.1:9223');
    expect(Factory).toBe(CDPBridge);
  });

  it('ignores empty/whitespace-only env var', () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', '   ');
    const Factory = getBrowserFactory('youtube');
    expect(Factory).toBe(BrowserBridge);
  });
});

describe('browserSession', () => {
  it('passes cdpEndpoint to browser connect', async () => {
    const connect = vi.fn().mockResolvedValue({
      close: vi.fn(),
    });

    class MockFactory {
      connect = connect;
      close = vi.fn().mockResolvedValue(undefined);
    }

    await browserSession(MockFactory as any, async (page) => page, {
      cdpEndpoint: 'http://127.0.0.1:9222',
    });

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpEndpoint: 'http://127.0.0.1:9222',
      }),
    );
  });
});
