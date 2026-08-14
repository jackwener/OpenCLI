import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static lastInstance: MockWebSocket | undefined;
    readyState = 1;
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_url: string) {
      MockWebSocket.lastInstance = this;
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

    emit(event: string, ...args: unknown[]): void {
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

import { CDPBridge, CDP_REQUEST_BODY_CAPTURE_LIMIT } from './cdp.js';

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

  it('exposes native input helpers on direct CDP pages', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({});

    const page = await bridge.connect();
    send.mockClear();

    expect(page.nativeType).toBeTypeOf('function');
    expect(page.nativeKeyPress).toBeTypeOf('function');
    expect(page.nativeClick).toBeTypeOf('function');
    expect(page.handleJavaScriptDialog).toBeTypeOf('function');
    expect(page.cdp).toBeTypeOf('function');

    await page.nativeType!('hello');
    await page.nativeKeyPress!('a', ['Ctrl']);
    await page.nativeClick!(10, 20);
    await page.handleJavaScriptDialog!(true, 'ok');
    await page.cdp!('Page.getLayoutMetrics', {});

    expect(send.mock.calls).toEqual([
      ['Input.insertText', { text: 'hello' }],
      ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2 }],
      ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2 }],
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 20 }],
      ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 }],
      ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 20, button: 'left', clickCount: 1 }],
      ['Page.handleJavaScriptDialog', { accept: true, promptText: 'ok' }],
      ['Page.getLayoutMetrics', {}],
    ]);
  });

  it('captures request headers and bounded post data on direct CDP pages', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    const fullBody = 'x'.repeat(CDP_REQUEST_BODY_CAPTURE_LIMIT + 5);
    vi.spyOn(bridge, 'send').mockImplementation(async (method: string) => {
      if (method === 'Network.getRequestPostData') return { postData: fullBody };
      return {};
    });

    const page = await bridge.connect();
    await page.startNetworkCapture?.();
    MockWebSocket.lastInstance?.emit('message', Buffer.from(JSON.stringify({
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'request-1',
        request: {
          method: 'POST',
          url: 'https://example.test/rsc-action/actions/pagination',
          headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
          hasPostData: true,
        },
      },
    })));

    const entries = await page.readNetworkCapture?.() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'POST',
      requestHeaders: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      requestBodyKind: 'string',
      requestBodyFullSize: fullBody.length,
      requestBodyTruncated: true,
    });
    expect(String(entries[0].requestBodyPreview)).toHaveLength(CDP_REQUEST_BODY_CAPTURE_LIMIT);
  });
});

describe('CDPBridge dedicated targets (remote Chrome)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  async function withDevtoolsServer(
    handler: (req: { method: string; url: string }) => { status: number; body: string },
    fn: (base: string, seen: Array<{ method: string; url: string }>) => Promise<void>,
  ): Promise<void> {
    const { createServer } = await import('node:http');
    const seen: Array<{ method: string; url: string }> = [];
    const server = createServer((req, res) => {
      const entry = { method: req.method ?? '', url: req.url ?? '' };
      seen.push(entry);
      const { status, body } = handler(entry);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await fn(`http://127.0.0.1:${port}`, seen);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('opens a dedicated tab instead of attaching to an existing one, and closes it on close()', async () => {
    await withDevtoolsServer(
      ({ method, url }) => {
        if (method === 'PUT' && url.startsWith('/json/new')) {
          return { status: 200, body: JSON.stringify({ id: 'T1', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/T1' }) };
        }
        if (method === 'GET' && url === '/json/close/T1') {
          return { status: 200, body: 'Target is closing' };
        }
        return { status: 500, body: '{}' };
      },
      async (base, seen) => {
        const bridge = new CDPBridge();
        vi.spyOn(bridge, 'send').mockResolvedValue({});

        await bridge.connect({ cdpEndpoint: base, dedicatedTarget: true });
        await bridge.close();

        expect(seen.map((r) => `${r.method} ${r.url.split('?')[0]}`)).toEqual([
          'PUT /json/new',
          'GET /json/close/T1',
        ]);
      },
    );
  });

  it('falls back to GET /json/new for Chrome versions that reject PUT', async () => {
    await withDevtoolsServer(
      ({ method, url }) => {
        if (url.startsWith('/json/new')) {
          if (method === 'PUT') return { status: 405, body: 'Using unsafe HTTP verb' };
          return { status: 200, body: JSON.stringify({ id: 'T2', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/T2' }) };
        }
        if (url === '/json/close/T2') return { status: 200, body: 'Target is closing' };
        return { status: 500, body: '{}' };
      },
      async (base, seen) => {
        const bridge = new CDPBridge();
        vi.spyOn(bridge, 'send').mockResolvedValue({});

        await bridge.connect({ cdpEndpoint: base, dedicatedTarget: true });
        await bridge.close();

        expect(seen.map((r) => `${r.method} ${r.url.split('?')[0]}`)).toEqual([
          'PUT /json/new',
          'GET /json/new',
          'GET /json/close/T2',
        ]);
      },
    );
  });

  it('keeps the legacy attach behaviour when dedicatedTarget is not requested', async () => {
    await withDevtoolsServer(
      ({ method, url }) => {
        if (method === 'GET' && url === '/json') {
          return {
            status: 200,
            body: JSON.stringify([
              { id: 'P1', type: 'page', url: 'https://example.com', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/P1' },
            ]),
          };
        }
        return { status: 500, body: '{}' };
      },
      async (base, seen) => {
        const bridge = new CDPBridge();
        vi.spyOn(bridge, 'send').mockResolvedValue({});

        await bridge.connect({ cdpEndpoint: base });
        await bridge.close();

        expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /json']);
      },
    );
  });
});
