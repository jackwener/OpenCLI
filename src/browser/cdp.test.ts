import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_url: string) {
      queueMicrotask(() => this.emit('open'));
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    send(_message: string): void {}

    close(): void {
      this.readyState = 3;
    }

    private emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  return { MockWebSocket };
});

vi.mock('ws', () => ({
  WebSocket: MockWebSocket,
}));

import { CDPBridge } from './cdp.js';

describe('CDPBridge cookies', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('filters cookies by actual domain match instead of substring match', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [
        { name: 'good', value: '1', domain: '.example.com' },
        { name: 'exact', value: '2', domain: 'example.com' },
        { name: 'bad', value: '3', domain: 'notexample.com' },
      ],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies({ domain: 'example.com' });

    expect(cookies).toEqual([
      { name: 'good', value: '1', domain: '.example.com' },
      { name: 'exact', value: '2', domain: 'example.com' },
    ]);
  });
});

describe('CDPBridge capture', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns warn entries from consoleMessages("error")', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect() as any;
    page._consoleErrors = [
      { level: 'warn', text: 'warning', timestamp: 1 },
      { level: 'error', text: 'boom', timestamp: 2 },
    ];
    page._consoleCapturing = true;

    await expect(page.consoleMessages('error')).resolves.toEqual([
      { level: 'warn', text: 'warning', timestamp: 1 },
      { level: 'error', text: 'boom', timestamp: 2 },
    ]);
  });

  it('stopCapture prevents later network events from appending', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect() as any;
    await page.startNetworkCapture('/api/');
    await page.stopCapture();

    page._onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://x.test/api/items', method: 'GET' },
      timestamp: 1,
    });

    await expect(page.readNetworkCapture()).resolves.toEqual([]);
  });

  it('does not register duplicate listeners across restart cycles', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});
    const onSpy = vi.spyOn(bridge, 'on');

    const page = await bridge.connect() as any;
    await page.startNetworkCapture('/api/');
    await page.stopCapture();
    await page.startNetworkCapture('/api/');

    expect(onSpy.mock.calls.filter(([event]) => event === 'Network.requestWillBeSent')).toHaveLength(1);
    expect(onSpy.mock.calls.filter(([event]) => event === 'Network.responseReceived')).toHaveLength(1);
    expect(onSpy.mock.calls.filter(([event]) => event === 'Network.loadingFinished')).toHaveLength(1);
    expect(onSpy.mock.calls.filter(([event]) => event === 'Runtime.consoleAPICalled')).toHaveLength(1);
    expect(onSpy.mock.calls.filter(([event]) => event === 'Runtime.exceptionThrown')).toHaveLength(1);
  });

  it('ignores stale response bodies from a previous capture generation', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    let resolveBody: ((value: unknown) => void) | undefined;
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockImplementation(async (method: string) => {
      if (method === 'Network.getResponseBody') {
        return await new Promise((resolve) => {
          resolveBody = resolve;
        });
      }
      return {};
    });

    const page = await bridge.connect() as any;
    await page.startNetworkCapture('/api/');
    page._onRequestWillBeSent({
      requestId: 'old',
      request: { url: 'https://x.test/api/old', method: 'GET' },
      timestamp: 1,
    });
    page._onLoadingFinished({ requestId: 'old' });

    await page.stopCapture();
    await page.startNetworkCapture('/api/');
    page._onRequestWillBeSent({
      requestId: 'new',
      request: { url: 'https://x.test/api/new', method: 'GET' },
      timestamp: 2,
    });

    resolveBody?.({ body: '{"stale":true}', base64Encoded: false });
    await Promise.resolve();

    await expect(page.readNetworkCapture()).resolves.toEqual([
      { url: 'https://x.test/api/new', method: 'GET', timestamp: 2 },
    ]);
  });

  it('does not clear console history when restarting network capture', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect() as any;
    page._consoleErrors = [
      { level: 'error', text: 'boom', timestamp: 1 },
    ];
    page._consoleCapturing = true;

    await page.startNetworkCapture('/api/');

    await expect(page.consoleMessages('error')).resolves.toEqual([
      { level: 'error', text: 'boom', timestamp: 1 },
    ]);
  });

  it('matches pipe-delimited capture patterns like the daemon path', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect() as any;
    await page.startNetworkCapture('/foo|/bar');

    page._onRequestWillBeSent({
      requestId: 'bar',
      request: { url: 'https://x.test/api/bar', method: 'GET' },
      timestamp: 1,
    });
    page._onRequestWillBeSent({
      requestId: 'baz',
      request: { url: 'https://x.test/api/baz', method: 'GET' },
      timestamp: 2,
    });

    await expect(page.readNetworkCapture()).resolves.toEqual([
      { url: 'https://x.test/api/bar', method: 'GET', timestamp: 1 },
    ]);
  });

  it('drops drained in-flight request bookkeeping after readNetworkCapture', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect() as any;
    await page.startNetworkCapture('/api/');

    page._onRequestWillBeSent({
      requestId: 'drained',
      request: { url: 'https://x.test/api/items', method: 'GET' },
      timestamp: 1,
    });

    await expect(page.readNetworkCapture()).resolves.toEqual([
      { url: 'https://x.test/api/items', method: 'GET', timestamp: 1 },
    ]);

    expect(() => {
      page._onResponseReceived({
        requestId: 'drained',
        response: { status: 200, mimeType: 'application/json' },
      });
      page._onLoadingFinished({ requestId: 'drained' });
    }).not.toThrow();
  });
});
