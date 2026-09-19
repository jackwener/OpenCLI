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

describe('CDPBridge session routing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  /** Drive send() against a fake peer: record every frame, and reject bare commands or not depending on the peer style. */
  async function drive(rejectBareNavigate: boolean) {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/page-1');
    const frames: Array<{ method: string; sessionId?: string }> = [];
    const original = MockWebSocket.prototype.send;
    MockWebSocket.prototype.send = function (this: InstanceType<typeof MockWebSocket>, message: string) {
      const { id, method, sessionId } = JSON.parse(message) as { id: number; method: string; sessionId?: string };
      frames.push({ method, sessionId });
      const reply = (body: Record<string, unknown>) =>
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id, ...body }))));
      if (rejectBareNavigate && method === 'Page.navigate' && !sessionId) {
        reply({ error: { code: -32601, message: 'No page for session' } });
      } else if (method === 'Target.createTarget') {
        reply({ result: { targetId: 'page-1' } });
      } else if (method === 'Target.attachToTarget') {
        reply({ result: { sessionId: 'page-1-session-1' } });
      } else {
        reply({ result: {} });
      }
    };
    try {
      const bridge = new CDPBridge();
      await bridge.connect();
      await bridge.send('Page.navigate', { url: 'https://example.com' });
      await bridge.send('Runtime.evaluate', {});
      return frames;
    } finally {
      MockWebSocket.prototype.send = original;
    }
  }

  it('attaches a flatten session when the peer rejects bare commands, then carries it', async () => {
    const frames = await drive(true);

    expect(frames.filter((f) => f.method === 'Page.navigate')).toEqual([
      { method: 'Page.navigate', sessionId: undefined },
      { method: 'Page.navigate', sessionId: 'page-1-session-1' },
    ]);
    expect(frames.map((f) => f.method)).toContain('Target.attachToTarget');
    // After the handshake the two connect() calls must be replayed on this session,
    // otherwise the stealth script is missing there
    expect(frames.filter((f) => f.method === 'Page.addScriptToEvaluateOnNewDocument').at(-1))
      .toEqual({ method: 'Page.addScriptToEvaluateOnNewDocument', sessionId: 'page-1-session-1' });
    // Every later command carries the session
    expect(frames.at(-1)).toEqual({ method: 'Runtime.evaluate', sessionId: 'page-1-session-1' });
  });

  it('never attaches against a Chrome-style peer', async () => {
    const frames = await drive(false);

    // Proves the exemption is narrow: when the peer does not answer "No page", this branch is dead code
    expect(frames.map((f) => f.method)).not.toContain('Target.createTarget');
    expect(frames.map((f) => f.method)).not.toContain('Target.attachToTarget');
    expect(frames.every((f) => f.sessionId === undefined)).toBe(true);
    expect(frames.filter((f) => f.method === 'Page.navigate')).toHaveLength(1);
  });
});
