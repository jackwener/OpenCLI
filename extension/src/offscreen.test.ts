import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG_BRIDGE_INIT, MSG_EXECUTE_COMMAND } from './protocol';

type RuntimeListener = (msg: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function createChromeMock() {
  const listeners: RuntimeListener[] = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          listeners.push(listener);
        }),
      },
      sendMessage: vi.fn(),
    },
  };

  return { chrome, listeners };
}

describe('offscreen daemon bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends daemon hello from bridge init context', async () => {
    const { chrome, listeners } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./offscreen');
    listeners[0]({
      type: MSG_BRIDGE_INIT,
      contextId: 'ctx-1',
      version: '1.0.4',
      compatRange: '>=1.7.0',
    }, {}, vi.fn());
    await vi.waitFor(() => expect(mod.__test__.getState().currentWebSocket).not.toBeNull());

    const ws = mod.__test__.getState().currentWebSocket as unknown as MockWebSocket;
    ws.open();

    expect(ws.url).toBe('ws://localhost:19825/ext');
    expect(ws.sent).toContain(JSON.stringify({
      type: 'hello',
      contextId: 'ctx-1',
      version: '1.0.4',
      compatRange: '>=1.7.0',
    }));
  });

  it('relays daemon commands through the service worker and returns results', async () => {
    const { chrome, listeners } = createChromeMock();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ id: 'cmd-1', ok: true, data: 42 });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./offscreen');
    listeners[0]({
      type: MSG_BRIDGE_INIT,
      contextId: 'ctx-1',
      version: '1.0.4',
      compatRange: '>=1.7.0',
    }, {}, vi.fn());
    await vi.waitFor(() => expect(mod.__test__.getState().currentWebSocket).not.toBeNull());

    const ws = mod.__test__.getState().currentWebSocket as unknown as MockWebSocket;
    ws.open();
    ws.receive({ id: 'cmd-1', action: 'exec', code: '1 + 1' });
    await vi.waitFor(() => {
      expect(ws.sent).toContain(JSON.stringify({ id: 'cmd-1', ok: true, data: 42 }));
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MSG_EXECUTE_COMMAND,
      command: { id: 'cmd-1', action: 'exec', code: '1 + 1' },
    });
  });

  it('reconnects after the daemon restarts', async () => {
    const { chrome, listeners } = createChromeMock();
    vi.stubGlobal('chrome', chrome);
    vi.useFakeTimers();

    const mod = await import('./offscreen');
    listeners[0]({
      type: MSG_BRIDGE_INIT,
      contextId: 'ctx-1',
      version: '1.0.4',
      compatRange: '>=1.7.0',
    }, {}, vi.fn());
    await vi.waitFor(() => expect(mod.__test__.getState().currentWebSocket).not.toBeNull());
    const first = mod.__test__.getState().currentWebSocket as unknown as MockWebSocket;
    first.open();
    first.close();

    expect(mod.__test__.getState().hasReconnectTimer).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);

    const second = mod.__test__.getState().currentWebSocket as unknown as MockWebSocket;
    expect(second).not.toBe(first);
    second.open();
    expect(second.sent).toContain(JSON.stringify({
      type: 'hello',
      contextId: 'ctx-1',
      version: '1.0.4',
      compatRange: '>=1.7.0',
    }));
  });
});
