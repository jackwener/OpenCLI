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

import { CDPBridge, __test__ } from './cdp.js';

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

describe('CDP target reuse', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives a stable tab name from the browser workspace', () => {
    expect(__test__.buildCDPTabName('site:douban', {})).toBe('opencli:site:douban');
    expect(__test__.buildCDPTabName(undefined, {})).toBe('opencli:default');
  });

  it('allows explicit tab names and opt-out via environment', () => {
    expect(__test__.buildCDPTabName('site:douban', { OPENCLI_CDP_TAB_NAME: 'douban-fixed' })).toBe('douban-fixed');
    expect(__test__.buildCDPTabName('site:douban', { OPENCLI_CDP_REUSE_TAB: 'false' })).toBeUndefined();
  });

  it('selects an existing CDP target by persistent window.name', async () => {
    const targets = [
      {
        id: 'a',
        type: 'page',
        title: '普通标签页',
        url: 'https://www.douban.com/',
        webSocketDebuggerUrl: 'ws://127.0.0.1/a',
      },
      {
        id: 'b',
        type: 'page',
        title: '大棋局 - 读书 - 豆瓣搜索',
        url: 'https://search.douban.com/book/subject_search?search_text=x',
        webSocketDebuggerUrl: 'ws://127.0.0.1/b',
      },
    ];

    const selected = await __test__.selectNamedCDPTarget(
      targets,
      'opencli:site:douban',
      async (target) => target.id === 'b' ? 'opencli:site:douban' : '',
    );

    expect(selected?.id).toBe('b');
  });

  it('does not pick Chrome internal popup targets', () => {
    expect(__test__.scoreCDPTarget({
      type: 'page',
      title: 'Omnibox Popup',
      url: 'chrome://omnibox-popup.top-chrome/',
      webSocketDebuggerUrl: 'ws://127.0.0.1/omnibox',
    })).toBe(Number.NEGATIVE_INFINITY);
  });
});
