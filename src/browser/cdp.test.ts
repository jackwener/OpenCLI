import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';

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
});

describe('CDPBridge dedicated target', () => {
  it('creates and closes an isolated tab for a website CLI', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url?.split('?')[0]}`);
      if (req.method === 'PUT' && req.url?.startsWith('/json/new')) {
        res.end(JSON.stringify({ id: 'T1', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/T1' }));
      } else if (req.method === 'GET' && req.url === '/json/close/T1') {
        res.end('Target is closing');
      } else {
        res.writeHead(500).end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    try {
      const bridge = new CDPBridge();
      vi.spyOn(bridge, 'send').mockResolvedValue({});
      await bridge.connect({ cdpEndpoint: endpoint, dedicatedTarget: true });
      await bridge.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(seen).toEqual(['PUT /json/new', 'GET /json/close/T1']);
  });
});
