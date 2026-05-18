import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendCommandMock, sendCommandFullMock } = vi.hoisted(() => ({
  sendCommandMock: vi.fn(),
  sendCommandFullMock: vi.fn(),
}));
const { warnMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
}));

vi.mock('./daemon-client.js', () => ({
  sendCommand: sendCommandMock,
  sendCommandFull: sendCommandFullMock,
}));
vi.mock('../logger.js', () => ({
  log: {
    warn: warnMock,
  },
}));

import { Page } from './page.js';

describe('Page.getCurrentUrl', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('reads the real browser URL when no local navigation cache exists', async () => {
    sendCommandMock.mockResolvedValueOnce('https://notebooklm.google.com/notebook/nb-live');

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');
    const url = await page.getCurrentUrl();

    expect(url).toBe('https://notebooklm.google.com/notebook/nb-live');
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      session: 'notebooklm',
      surface: 'adapter',
    }));
  });

  it('caches the discovered browser URL for later reads', async () => {
    sendCommandMock.mockResolvedValueOnce('https://notebooklm.google.com/notebook/nb-live');

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');
    expect(await page.getCurrentUrl()).toBe('https://notebooklm.google.com/notebook/nb-live');
    expect(await page.getCurrentUrl()).toBe('https://notebooklm.google.com/notebook/nb-live');

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
  });

  it('passes adapter site session lifecycle through daemon commands', async () => {
    sendCommandFullMock.mockResolvedValueOnce({ page: 'page-1', data: { url: 'https://chatgpt.com/' } });
    sendCommandMock.mockResolvedValueOnce(null);

    const page = new Page('site:chatgpt', undefined, undefined, undefined, 'adapter', 'persistent');

    await page.goto('https://chatgpt.com/', { waitUntil: 'none' });
    await page.evaluate('document.title');

    expect(sendCommandFullMock).toHaveBeenCalledWith('navigate', expect.objectContaining({
      session: 'site:chatgpt',
      surface: 'adapter',
      siteSession: 'persistent',
    }));
    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      session: 'site:chatgpt',
      surface: 'adapter',
      siteSession: 'persistent',
      page: 'page-1',
    }));
  });
});

describe('Page.evaluate', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('retries once when the inspected target navigated during exec', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('{"code":-32000,"message":"Inspected target navigated or closed"}'))
      .mockResolvedValueOnce(42);

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');
    const value = await page.evaluate('21 + 21');

    expect(value).toBe(42);
    expect(sendCommandMock).toHaveBeenCalledTimes(2);
  });

  it('serializes function-form evaluate calls with JSON args', async () => {
    sendCommandMock.mockResolvedValueOnce('/opencli');

    const page = new Page('twitter', undefined, undefined, undefined, 'adapter');
    const href = await page.evaluate((selector: string) => {
      const link = document.querySelector(selector);
      return link ? link.getAttribute('href') : null;
    }, 'a[data-testid="AppTabBar_Profile_Link"]');

    expect(href).toBe('/opencli');
    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      session: 'twitter',
      surface: 'adapter',
      code: expect.stringContaining('(...["a[data-testid=\\"AppTabBar_Profile_Link\\"]"])'),
    }));
    const code = sendCommandMock.mock.calls[0]?.[1]?.code as string;
    expect(code).toContain('document.querySelector(selector)');
  });

  it('rejects non-JSON-serializable evaluate args before sending to the daemon', async () => {
    const page = new Page('default');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(page.evaluate((value: unknown) => value, circular)).rejects.toThrow('JSON-serializable');
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('keeps string evaluate behavior unchanged', async () => {
    sendCommandMock.mockResolvedValueOnce(42);

    const page = new Page('default');
    await expect(page.evaluate('21 + 21')).resolves.toBe(42);

    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      code: '21 + 21',
    }));
  });
});

describe('Page network capture compatibility', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('treats unknown network-capture-start as unsupported and memoizes it', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Unknown action: network-capture-start'));

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');

    await expect(page.startNetworkCapture()).resolves.toBe(false);
    await expect(page.startNetworkCapture()).resolves.toBe(false);

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('does not support network capture'));
    expect(sendCommandMock).toHaveBeenCalledWith('network-capture-start', expect.objectContaining({
      session: 'notebooklm',
      surface: 'adapter',
    }));
  });

  it('returns an empty capture when network-capture-read is unsupported', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Unknown action: network-capture-read'));

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');

    await expect(page.readNetworkCapture()).resolves.toEqual([]);
    await expect(page.readNetworkCapture()).resolves.toEqual([]);

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith('network-capture-read', expect.objectContaining({
      session: 'notebooklm',
      surface: 'adapter',
    }));
  });

  it('rethrows unrelated network capture failures', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Extension disconnected'));

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');

    await expect(page.startNetworkCapture()).rejects.toThrow('Extension disconnected');
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns only once even if both start and read hit the compatibility fallback', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-start'))
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-read'));

    const page = new Page('notebooklm', undefined, undefined, undefined, 'adapter');

    await expect(page.startNetworkCapture()).resolves.toBe(false);
    await expect(page.readNetworkCapture()).resolves.toEqual([]);

    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});

describe('Page download waits', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('sends wait-download through the daemon with session and timeout', async () => {
    sendCommandMock.mockResolvedValueOnce({
      downloaded: true,
      filename: '/tmp/receipt.pdf',
      state: 'complete',
      elapsedMs: 5,
    });

    const page = new Page('mercury', undefined, undefined, undefined, 'adapter');
    const result = await page.waitForDownload('receipt', 1234);

    expect(result).toEqual({
      downloaded: true,
      filename: '/tmp/receipt.pdf',
      state: 'complete',
      elapsedMs: 5,
    });
    expect(sendCommandMock).toHaveBeenCalledWith('wait-download', expect.objectContaining({
      session: 'mercury',
      surface: 'adapter',
      pattern: 'receipt',
      timeoutMs: 1234,
    }));
  });
});

describe('Page CDP helpers', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('handles JavaScript dialogs through the CDP passthrough', async () => {
    sendCommandMock.mockResolvedValueOnce({});

    const page = new Page('default');
    await page.handleJavaScriptDialog(true, 'confirm');

    expect(sendCommandMock).toHaveBeenCalledWith('cdp', expect.objectContaining({
      session: 'default',
      surface: 'browser',
      cdpMethod: 'Page.handleJavaScriptDialog',
      cdpParams: { accept: true, promptText: 'confirm' },
    }));
  });
});

describe('Page active target tracking', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('tracks only one active page identity at a time', async () => {
    sendCommandFullMock
      .mockResolvedValueOnce({ data: { url: 'https://first.example' }, page: 'page-1' })
      .mockResolvedValueOnce({ data: { selected: true }, page: 'page-2' });
    sendCommandMock.mockResolvedValue('ok');

    const page = new Page('default');

    await page.goto('https://first.example', { waitUntil: 'none' });
    expect(page.getActivePage()).toBe('page-1');

    await page.selectTab(1);
    expect(page.getActivePage()).toBe('page-2');

    await page.evaluate('1 + 1');

    expect(sendCommandMock).toHaveBeenLastCalledWith('exec', expect.objectContaining({
      session: 'default',
      surface: 'browser',
      page: 'page-2',
    }));
  });

  it('allows the caller to bind a specific active page identity explicitly', async () => {
    sendCommandMock.mockResolvedValue('bound');

    const page = new Page('default');
    page.setActivePage?.('page-explicit');

    await page.evaluate('1 + 1');

    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      session: 'default',
      surface: 'browser',
      page: 'page-explicit',
    }));
  });

  // Regression: a Page instance can keep re-sending a cached targetId after the tab
  // has been closed externally, so the extension throws
  // "Page not found: <id> — stale page identity" on follow-up navigation.
  // goto() now drops the stale identity and retries once without it so the extension's
  // session lease can resolve through to a live tab.
  it('drops a stale page identity and retries navigate once', async () => {
    sendCommandFullMock
      .mockResolvedValueOnce({ data: { url: 'https://example.com/first' }, page: 'page-1' })
      .mockRejectedValueOnce(new Error('Page not found: deadbeef — stale page identity'))
      .mockResolvedValueOnce({ data: { url: 'https://example.com/second' }, page: 'page-2' });

    const page = new Page('site:youtube', undefined, undefined, undefined, 'adapter', 'persistent');

    await page.goto('https://example.com/first', { waitUntil: 'none' });
    expect(page.getActivePage()).toBe('page-1');

    await page.goto('https://example.com/second', { waitUntil: 'none' });
    expect(page.getActivePage()).toBe('page-2');

    expect(sendCommandFullMock).toHaveBeenCalledTimes(3);
    // First retry attempt carried the stale page; the recovery call must drop it.
    const retryCall = sendCommandFullMock.mock.calls[2];
    expect(retryCall[0]).toBe('navigate');
    expect(retryCall[1]).not.toHaveProperty('page');
  });

  it('does not retry stale page errors when no identity was cached', async () => {
    // _page is undefined on a fresh Page — there's nothing to drop, so propagate the
    // error instead of silently retrying with the same params.
    sendCommandFullMock
      .mockRejectedValueOnce(new Error('Page not found: deadbeef — stale page identity'));

    const page = new Page('site:youtube', undefined, undefined, undefined, 'adapter', 'persistent');

    await expect(page.goto('https://example.com', { waitUntil: 'none' }))
      .rejects.toThrow('stale page identity');
    expect(sendCommandFullMock).toHaveBeenCalledTimes(1);
  });

  it('propagates non-stale navigate errors unchanged', async () => {
    sendCommandFullMock
      .mockResolvedValueOnce({ data: { url: 'https://example.com/first' }, page: 'page-1' })
      .mockRejectedValueOnce(new Error('Extension disconnected'));

    const page = new Page('site:youtube', undefined, undefined, undefined, 'adapter', 'persistent');

    await page.goto('https://example.com/first', { waitUntil: 'none' });
    await expect(page.goto('https://example.com/second', { waitUntil: 'none' }))
      .rejects.toThrow('Extension disconnected');
    // No retry for unrelated errors — exactly two navigate calls total.
    expect(sendCommandFullMock).toHaveBeenCalledTimes(2);
  });

  it('creates a new tab without changing the current active page binding', async () => {
    sendCommandFullMock
      .mockResolvedValueOnce({ data: { url: 'https://first.example' }, page: 'page-1' })
      .mockResolvedValueOnce({
        data: { url: 'https://second.example' },
        page: 'page-2',
      });
    sendCommandMock.mockResolvedValue('ok');

    const page = new Page('default');
    await page.goto('https://first.example', { waitUntil: 'none' });

    const created = await page.newTab?.('https://second.example');

    expect(created).toBe('page-2');
    expect(page.getActivePage()).toBe('page-1');
    await page.evaluate('1 + 1');
    expect(sendCommandMock).toHaveBeenLastCalledWith('exec', expect.objectContaining({
      session: 'default',
      surface: 'browser',
      page: 'page-1',
    }));
  });

  it('allows the caller to adopt a new tab explicitly after creation', async () => {
    sendCommandFullMock.mockResolvedValueOnce({
      data: { url: 'https://second.example' },
      page: 'page-2',
    });

    const page = new Page('default');
    const created = await page.newTab?.('https://second.example');

    expect(created).toBe('page-2');
    expect(page.getActivePage()).toBeUndefined();

    page.setActivePage?.(created);
    expect(page.getActivePage()).toBe('page-2');
    expect(sendCommandFullMock).toHaveBeenCalledWith('tabs', expect.objectContaining({
      op: 'new',
      url: 'https://second.example',
      session: 'default',
      surface: 'browser',
    }));
  });

  it('closes a tab by explicit page identity', async () => {
    sendCommandMock.mockResolvedValueOnce({ closed: 'page-2' });

    const page = new Page('default');
    await page.closeTab?.('page-2');

    expect(sendCommandMock).toHaveBeenCalledWith('tabs', expect.objectContaining({
      op: 'close',
      session: 'default',
      surface: 'browser',
      page: 'page-2',
    }));
  });

  it('clears the active page binding when closing the selected tab by numeric index', async () => {
    sendCommandFullMock.mockResolvedValueOnce({ data: { selected: true }, page: 'page-2' });
    sendCommandMock
      .mockResolvedValueOnce({ closed: 'page-2' })
      .mockResolvedValueOnce('ok');

    const page = new Page('default');

    await page.selectTab(1);
    expect(page.getActivePage()).toBe('page-2');

    await page.closeTab?.(1);
    expect(page.getActivePage()).toBeUndefined();

    await page.evaluate('1 + 1');

    const evalCall = sendCommandMock.mock.calls.at(-1);
    expect(evalCall?.[0]).toBe('exec');
    expect(evalCall?.[1]).toEqual(expect.objectContaining({
      session: 'default',
      surface: 'browser',
    }));
    expect(evalCall?.[1]).not.toHaveProperty('page');
  });
});

describe('Page.screenshot', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('forwards width / height / fullPage options to the bridge', async () => {
    sendCommandMock.mockResolvedValueOnce('BASE64');

    const page = new Page('default');
    const data = await page.screenshot({ fullPage: true, width: 1080 });

    expect(data).toBe('BASE64');
    expect(sendCommandMock).toHaveBeenCalledWith('screenshot', expect.objectContaining({
      session: 'default',
      surface: 'browser',
      fullPage: true,
      width: 1080,
    }));
  });

  it('omits viewport overrides when none are set', async () => {
    sendCommandMock.mockResolvedValueOnce('BASE64');

    const page = new Page('default');
    await page.screenshot();

    const call = sendCommandMock.mock.calls.at(-1);
    expect(call?.[0]).toBe('screenshot');
    const args = call?.[1] as Record<string, unknown>;
    expect(args.width).toBeUndefined();
    expect(args.height).toBeUndefined();
    expect(args.fullPage).toBeUndefined();
  });
});
