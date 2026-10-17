import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
        { name: 'child', value: '4', domain: 'account.example.com' },
        { name: 'bad', value: '3', domain: 'notexample.com' },
      ],
    });

    const page = await bridge.connect();
    const cookies = await page.getCookies({ domain: 'example.com' });

    expect(bridge.send).toHaveBeenCalledWith('Storage.getCookies', {});
    expect(cookies).toEqual([
      { name: 'good', value: '1', domain: '.example.com' },
      { name: 'exact', value: '2', domain: 'example.com' },
      { name: 'child', value: '4', domain: 'account.example.com' },
    ]);
  });

  it.each([{}, { cookies: null }, { cookies: [null] }])('rejects malformed cookie responses %j', async result => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue(result);
    const page = await bridge.connect();
    await expect(page.getCookies({ domain: 'example.com' })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    await bridge.close();
  });

  it('matches Chrome domain filtering rather than URL applicability', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({ cookies: [
      { name: 'parent', value: '1', domain: '.example.com' },
      { name: 'exact', value: '2', domain: 'account.example.com' },
      { name: 'child', value: '3', domain: 'secure.account.example.com' },
    ] });
    const page = await bridge.connect();
    expect((await page.getCookies({ domain: 'account.example.com' })).map(c => c.name)).toEqual(['exact', 'child']);
    await bridge.close();
  });

  it('retains URL/path scoping for URL cookie queries', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({ cookies: [] });
    const page = await bridge.connect();
    await page.getCookies({ url: 'https://example.com/account' });
    expect(bridge.send).toHaveBeenCalledWith('Network.getCookies', { urls: ['https://example.com/account'] });
    await bridge.close();
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

  it('retains one redirect chain and drains it after the final response', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({ body: 'final answer', base64Encoded: false });
    const page = await bridge.connect();
    await page.startNetworkCapture?.('api.example');
    const fire = (method: string, params: unknown) => MockWebSocket.lastInstance?.emit('message',
      Buffer.from(JSON.stringify({ method, params })));
    fire('Network.requestWillBeSent', { requestId: 'redirect', request: {
      method: 'POST', url: 'https://api.example/start', hasPostData: true, postData: 'original payload',
    } });
    await page.readNetworkCapture?.({ retainIncomplete: true });
    fire('Network.requestWillBeSent', { requestId: 'redirect', redirectResponse: { status: 302 }, request: {
      method: 'GET', url: 'https://api.example/finish',
    } });
    fire('Network.responseReceived', { requestId: 'redirect', response: { status: 200 } });
    fire('Network.loadingFinished', { requestId: 'redirect' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([
      expect.objectContaining({ requestId: 'redirect', method: 'POST', requestBodyPreview: 'original payload',
        responsePreview: 'final answer', captureComplete: true }),
    ]);
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([]);
  });

  it('reindexes remaining requests after a completed entry is drained', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockResolvedValue({ body: 'body', base64Encoded: false });
    const page = await bridge.connect();
    await page.startNetworkCapture?.('api.example');
    const fire = (method: string, params: unknown) => MockWebSocket.lastInstance?.emit('message',
      Buffer.from(JSON.stringify({ method, params })));
    for (const requestId of ['done', 'pending']) {
      fire('Network.requestWillBeSent', { requestId, request: { method: 'GET', url: 'https://api.example/' + requestId } });
    }
    fire('Network.loadingFailed', { requestId: 'done' });
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toHaveLength(2);
    fire('Network.responseReceived', { requestId: 'pending', response: { status: 201 } });
    fire('Network.loadingFinished', { requestId: 'pending' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([
      expect.objectContaining({ requestId: 'pending', responseStatus: 201, responsePreview: 'body', captureComplete: true }),
    ]);
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([]);
  });

  it('retains an early-read request until the delayed response body completes', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    let releaseBody!: (value: unknown) => void;
    const body = new Promise(resolve => { releaseBody = resolve; });
    vi.spyOn(bridge, 'send').mockImplementation(async (method: string) =>
      method === 'Network.getResponseBody' ? body : {});
    const page = await bridge.connect();
    await page.startNetworkCapture?.('api.example');
    const fire = (method: string, params: unknown) => MockWebSocket.lastInstance?.emit('message',
      Buffer.from(JSON.stringify({ method, params })));
    fire('Network.requestWillBeSent', { requestId: 'r2', request: { method: 'POST', url: 'https://api.example/gen', postData: '{}', hasPostData: true } });
    const early = await page.readNetworkCapture?.({ retainIncomplete: true }) as Array<Record<string, unknown>>;
    expect(early[0].responsePreview).toBeUndefined();
    fire('Network.responseReceived', { requestId: 'r2', response: { status: 200 } });
    fire('Network.loadingFinished', { requestId: 'r2' });
    releaseBody({ body: '{"clips":[]}', base64Encoded: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    const completed = await page.readNetworkCapture?.({ retainIncomplete: true }) as Array<Record<string, unknown>>;
    expect(completed[0]).toMatchObject({ responseStatus: 200, responsePreview: '{"clips":[]}', captureComplete: true });
    expect(completed[0].requestId).toBe('r2');
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([]);
  });

  it('does not complete a capture before its delayed request post data arrives', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    let releasePostData!: (value: unknown) => void;
    const postData = new Promise(resolve => { releasePostData = resolve; });
    vi.spyOn(bridge, 'send').mockImplementation(async (method: string) =>
      method === 'Network.getRequestPostData' ? postData : { body: '{"ok":1}', base64Encoded: false });
    const page = await bridge.connect();
    await page.startNetworkCapture?.('api.example');
    const fire = (method: string, params: unknown) => MockWebSocket.lastInstance?.emit('message',
      Buffer.from(JSON.stringify({ method, params })));
    fire('Network.requestWillBeSent', { requestId: 'r3', request: { method: 'POST', url: 'https://api.example/gen', hasPostData: true } });
    fire('Network.responseReceived', { requestId: 'r3', response: { status: 200 } });
    fire('Network.loadingFinished', { requestId: 'r3' });
    await new Promise(resolve => setTimeout(resolve, 0));
    // Response body is settled, but the request body fetch has not landed:
    // the entry must stay incomplete so a retaining read keeps it.
    const beforePostData = await page.readNetworkCapture?.({ retainIncomplete: true }) as Array<Record<string, unknown>>;
    expect(beforePostData[0].responsePreview).toBe('{"ok":1}');
    expect(beforePostData[0].captureComplete).toBe(false);
    releasePostData({ postData: '{"mv":"v6"}' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const complete = await page.readNetworkCapture?.({ retainIncomplete: true }) as Array<Record<string, unknown>>;
    expect(complete[0]).toMatchObject({ requestBodyPreview: '{"mv":"v6"}', captureComplete: true });
    expect(await page.readNetworkCapture?.({ retainIncomplete: true })).toEqual([]);
  });

  it('returns a retaining snapshot without waiting on a stalled response body fetch', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    vi.spyOn(bridge, 'send').mockImplementation(async (method: string) =>
      method === 'Network.getResponseBody' ? new Promise(() => {}) : {});
    const page = await bridge.connect();
    await page.startNetworkCapture?.('api.example');
    const fire = (method: string, params: unknown) => MockWebSocket.lastInstance?.emit('message',
      Buffer.from(JSON.stringify({ method, params })));
    fire('Network.requestWillBeSent', { requestId: 'r4', request: { method: 'POST', url: 'https://api.example/gen', postData: '{}', hasPostData: true } });
    fire('Network.responseReceived', { requestId: 'r4', response: { status: 200 } });
    fire('Network.loadingFinished', { requestId: 'r4' });
    const reading = page.readNetworkCapture?.({ retainIncomplete: true }) as Promise<Array<Record<string, unknown>>>;
    const snapshot = await Promise.race([
      reading,
      new Promise((_, reject) => setTimeout(() => reject(new Error('retaining read blocked on a stalled body fetch')), 50)),
    ]) as Array<Record<string, unknown>>;
    expect(snapshot[0]).toMatchObject({ requestId: 'r4', responseStatus: 200 });
    expect(snapshot[0].responsePreview).toBeUndefined();
  });
});

describe('CDPBridge init script', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  const initScripts = (calls: unknown[][]) => calls
    .filter(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')
    .map(([, params]) => (params as { source: string }).source);

  it('registers OPENCLI_CDP_INIT_SCRIPT after the stealth script', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const dir = mkdtempSync(join(tmpdir(), 'opencli-init-'));
    tempDirs.push(dir);
    const file = join(dir, 'init.js');
    writeFileSync(file, 'window.__opencliInit = 1;');
    vi.stubEnv('OPENCLI_CDP_INIT_SCRIPT', file);

    const bridge = new CDPBridge();
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({});
    await bridge.connect();

    const sources = initScripts(send.mock.calls);
    expect(sources).toHaveLength(2);
    expect(sources[1]).toBe('window.__opencliInit = 1;');
    await bridge.close();
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO before opening a CDP connection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencli-init-'));
    tempDirs.push(dir);
    const file = join(dir, 'init.pipe');
    execFileSync('mkfifo', [file]);
    vi.stubEnv('OPENCLI_CDP_INIT_SCRIPT', file);
    const previousSocket = MockWebSocket.lastInstance;
    await expect(new CDPBridge().connect({ cdpEndpoint: 'ws://127.0.0.1:9222' }))
      .rejects.toThrow('regular JavaScript file');
    expect(MockWebSocket.lastInstance).toBe(previousSocket);
  });

  it('registers only the stealth script when unset', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');

    const bridge = new CDPBridge();
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({});
    await bridge.connect();

    expect(initScripts(send.mock.calls)).toHaveLength(1);
    await bridge.close();
  });
});

describe('CDPPage.evaluateOnce', () => {
  it('does not resend Runtime.evaluate after a target navigation', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'ws://127.0.0.1:9222/devtools/page/1');
    const bridge = new CDPBridge();
    const send = vi.spyOn(bridge, 'send').mockResolvedValue({});
    const page = await bridge.connect();
    send.mockClear();
    const error = new Error('Inspected target navigated or closed');
    send.mockRejectedValue(error);
    await expect(page.evaluateOnce!('publishComment()')).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    await bridge.close();
    vi.unstubAllEnvs();
  });
});
