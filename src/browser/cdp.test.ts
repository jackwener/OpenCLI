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
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [
        { name: 'good', value: '1', domain: '.example.com' },
        { name: 'exact', value: '2', domain: 'example.com' },
        { name: 'sub', value: '3', domain: 'api.example.com' },
        { name: 'dot-sub', value: '4', domain: '.api.example.com' },
        { name: 'bad', value: '3', domain: 'notexample.com' },
      ],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies({ domain: 'example.com' });

    expect(cookies).toEqual([
      { name: 'good', value: '1', domain: '.example.com' },
      { name: 'exact', value: '2', domain: 'example.com' },
      { name: 'sub', value: '3', domain: 'api.example.com' },
      { name: 'dot-sub', value: '4', domain: '.api.example.com' },
    ]);
    expect(send).toHaveBeenCalledWith('Storage.getCookies', {});
    expect(send).not.toHaveBeenCalledWith('Network.getCookies', {});
  });

  it('keeps URL-scoped cookies on Network.getCookies with urls', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [
        { name: 'session', value: '1', domain: '.example.com' },
      ],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies({ url: 'https://example.com/path' });

    expect(cookies).toEqual([{ name: 'session', value: '1', domain: '.example.com' }]);
    expect(send).toHaveBeenCalledWith('Network.getCookies', { urls: ['https://example.com/path'] });
  });

  it('normalizes CDP cookie fields and renames `expires` to `expirationDate`', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    // Real-shape CDP cookie record (excerpt) — `Network.Cookie` uses `expires`,
    // not `expirationDate`. Consumers that also drive the chrome.cookies
    // extension transport expect `expirationDate`, so the bridge must rename.
    vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [{
        name: 'session',
        value: 'abc',
        domain: '.larkoffice.com',
        path: '/',
        expires: 1781234567,
        size: 64,
        httpOnly: true,
        secure: true,
        session: false,
        sameSite: 'None',
        priority: 'Medium',
        sourceScheme: 'Secure',
        sourcePort: 443,
      }],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies();

    expect(cookies).toEqual([{
      name: 'session',
      value: 'abc',
      domain: '.larkoffice.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1781234567,
      session: false,
      sameSite: 'None',
      size: 64,
      priority: 'Medium',
      sourceScheme: 'Secure',
      sourcePort: 443,
    }]);
    // `expires` should not leak through under its CDP name.
    expect((cookies[0] as unknown as Record<string, unknown>).expires).toBeUndefined();
  });

  it('omits `expirationDate` for session cookies (CDP signals -1 / 0)', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [
        { name: 'a', value: '1', domain: 'example.com', expires: -1, session: true },
        { name: 'b', value: '2', domain: 'example.com', expires: 0, session: true },
      ],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies();

    expect(cookies[0]).not.toHaveProperty('expirationDate');
    expect(cookies[1]).not.toHaveProperty('expirationDate');
    expect(cookies[0].session).toBe(true);
  });

  it('rejects malformed CDP cookie envelopes instead of silently returning empty', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({ cookiez: [] });

    const page = await bridge.connect();

    await expect(page.getCookies()).rejects.toThrow('expected { cookies: [] }');
  });

  it('rejects malformed CDP cookie records instead of dropping them', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({
      cookies: [
        { name: 'session', value: 'abc', domain: '.example.com' },
        { name: 'broken', value: 'abc' },
      ],
    });

    const page = await bridge.connect();

    await expect(page.getCookies()).rejects.toThrow('malformed cookie at index 1');
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
