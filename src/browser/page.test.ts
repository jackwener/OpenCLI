import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendCommandMock } = vi.hoisted(() => ({
  sendCommandMock: vi.fn(),
}));

vi.mock('./daemon-client.js', () => ({
  sendCommand: sendCommandMock,
}));

import { Page } from './page.js';

describe('Page.getCurrentUrl', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
  });

  it('reads the real browser URL when no local navigation cache exists', async () => {
    sendCommandMock.mockResolvedValueOnce('https://notebooklm.google.com/notebook/nb-live');

    const page = new Page('site:notebooklm');
    const url = await page.getCurrentUrl();

    expect(url).toBe('https://notebooklm.google.com/notebook/nb-live');
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith('exec', expect.objectContaining({
      workspace: 'site:notebooklm',
    }));
  });

  it('caches the discovered browser URL for later reads', async () => {
    sendCommandMock.mockResolvedValueOnce('https://notebooklm.google.com/notebook/nb-live');

    const page = new Page('site:notebooklm');
    expect(await page.getCurrentUrl()).toBe('https://notebooklm.google.com/notebook/nb-live');
    expect(await page.getCurrentUrl()).toBe('https://notebooklm.google.com/notebook/nb-live');

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe('Page.evaluate', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
  });

  it('retries once when the inspected target navigated during exec', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('{"code":-32000,"message":"Inspected target navigated or closed"}'))
      .mockResolvedValueOnce(42);

    const page = new Page('site:notebooklm');
    const value = await page.evaluate('21 + 21');

    expect(value).toBe(42);
    expect(sendCommandMock).toHaveBeenCalledTimes(2);
  });
});

describe('Page.consoleMessages', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
  });

  it('filters daemon console messages locally and keeps warn in error mode', async () => {
    sendCommandMock.mockResolvedValueOnce([
      { level: 'warn', text: 'careful' },
      { level: 'error', text: 'boom' },
      { level: 'info', text: 'hello' },
    ]);

    const page = new Page('site:test');

    await expect(page.consoleMessages('error')).resolves.toEqual([
      { level: 'warn', text: 'careful' },
      { level: 'error', text: 'boom' },
    ]);
    expect(sendCommandMock).toHaveBeenCalledWith('console-read', expect.objectContaining({
      workspace: 'site:test',
    }));
  });

  it('sends capture-stop to the daemon', async () => {
    sendCommandMock.mockResolvedValueOnce({ stopped: true });

    const page = new Page('site:test');
    await page.stopCapture();

    expect(sendCommandMock).toHaveBeenCalledWith('capture-stop', expect.objectContaining({
      workspace: 'site:test',
    }));
  });

  it('gracefully tolerates unsupported capture actions from a stale extension', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-start'))
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-read'))
      .mockResolvedValueOnce([{ url: 'https://fallback.test', method: 'GET' }])
      .mockRejectedValueOnce(new Error('Unknown action: console-read'))
      .mockRejectedValueOnce(new Error('Unknown action: capture-stop'));

    const page = new Page('site:test');

    await expect(page.startNetworkCapture('/api/')).resolves.toBeUndefined();
    await expect(page.readNetworkCapture()).resolves.toEqual([{ url: 'https://fallback.test', method: 'GET' }]);
    await expect(page.consoleMessages('error')).resolves.toEqual([]);
    await expect(page.stopCapture()).resolves.toBeUndefined();
    expect(page.hasNativeCaptureSupport()).toBe(false);
  });
});
