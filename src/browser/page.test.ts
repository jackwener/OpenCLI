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
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
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

describe('Page network capture compatibility', () => {
  beforeEach(() => {
    sendCommandMock.mockReset();
    sendCommandFullMock.mockReset();
    warnMock.mockReset();
  });

  it('treats unknown network-capture-start as unsupported and memoizes it', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Unknown action: network-capture-start'));

    const page = new Page('site:notebooklm');

    await expect(page.startNetworkCapture()).resolves.toBe(false);
    await expect(page.startNetworkCapture()).resolves.toBe(false);

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('does not support network capture'));
    expect(sendCommandMock).toHaveBeenCalledWith('network-capture-start', expect.objectContaining({
      workspace: 'site:notebooklm',
    }));
  });

  it('returns an empty capture when network-capture-read is unsupported', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Unknown action: network-capture-read'));

    const page = new Page('site:notebooklm');

    await expect(page.readNetworkCapture()).resolves.toEqual([]);
    await expect(page.readNetworkCapture()).resolves.toEqual([]);

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith('network-capture-read', expect.objectContaining({
      workspace: 'site:notebooklm',
    }));
  });

  it('rethrows unrelated network capture failures', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Extension disconnected'));

    const page = new Page('site:notebooklm');

    await expect(page.startNetworkCapture()).rejects.toThrow('Extension disconnected');
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns only once even if both start and read hit the compatibility fallback', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-start'))
      .mockRejectedValueOnce(new Error('Unknown action: network-capture-read'));

    const page = new Page('site:notebooklm');

    await expect(page.startNetworkCapture()).resolves.toBe(false);
    await expect(page.readNetworkCapture()).resolves.toEqual([]);

    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
