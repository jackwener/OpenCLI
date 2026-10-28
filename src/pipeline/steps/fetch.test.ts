import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ArgumentError, CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { stepFetch } from './fetch.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stepFetch', () => {
  it('sends query parameters to the HTTP server when the URL has a fragment', async () => {
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ url: request.url }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const port = (server.address() as AddressInfo).port;
      await expect(stepFetch(null, {
        url: `http://127.0.0.1:${port}/search?existing=1#details`,
        params: { q: 'a&b' },
      }, null, {})).resolves.toEqual({ url: '/search?existing=1&q=a%26b' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it.each([
    ['/search#details?view=1', '/search?q=a%26b#details?view=1'],
    ['/search?existing=1#details', '/search?existing=1&q=a%26b#details'],
  ])('keeps browser query parameters before the fragment in %s', async (suffix, expected) => {
    const fetchJson = vi.fn().mockResolvedValue({ ok: true });
    const page = { fetchJson } as unknown as IPage;
    await stepFetch(page, {
      url: `https://api.example.com${suffix}`,
      params: { q: 'a&b' },
    }, null, {});
    expect(fetchJson).toHaveBeenCalledWith(`https://api.example.com${expected}`, {
      method: 'GET', headers: {},
    });
  });

  // W1 + W4: non-browser single fetch throws CliError with FETCH_ERROR code and full message
  it('throws CliError with FETCH_ERROR code on non-ok responses without a browser session', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'rate limited' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const err = await stepFetch(null, { url: 'https://api.example.com/items' }, null, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('FETCH_ERROR');
    expect((err as CliError).message).toBe('HTTP 429 Too Many Requests from https://api.example.com/items');
    expect(jsonMock).not.toHaveBeenCalled();
  });

  // W1 + W3: browser single fetch delegates to page.fetchJson, which owns browser-context fetch errors
  it('throws CliError with FETCH_ERROR code on non-ok responses inside the browser session', async () => {
    const page = {
      fetchJson: vi.fn().mockRejectedValue(new CliError(
        'FETCH_ERROR',
        'HTTP 401 Unauthorized from https://api.example.com/items',
      )),
    } as unknown as IPage;

    const err = await stepFetch(page, { url: 'https://api.example.com/items' }, null, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('FETCH_ERROR');
    expect((err as CliError).message).toBe('HTTP 401 Unauthorized from https://api.example.com/items');
    expect(page.fetchJson).toHaveBeenCalledWith('https://api.example.com/items', {
      method: 'GET',
      headers: {},
    });
  });

  it('returns per-item HTTP errors for batch fetches without a browser session', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'upstream unavailable' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(stepFetch(
      null,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }],
      {},
    )).resolves.toEqual([
      { error: 'HTTP 503 Service Unavailable from https://api.example.com/items/1' },
    ]);
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('returns per-item HTTP errors for batch browser fetches', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'upstream unavailable' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = {
      evaluate: vi.fn(async (js: string) => Function(`return (${js})`)()()),
    } as unknown as IPage;

    await expect(stepFetch(
      page,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }],
      {},
    )).resolves.toEqual([
      { error: 'HTTP 503 Service Unavailable from https://api.example.com/items/1' },
    ]);
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('rejects invalid browser batch concurrency before evaluating page code', async () => {
    const page = {
      evaluate: vi.fn(),
    } as unknown as IPage;

    await expect(stepFetch(
      page,
      { url: 'https://api.example.com/items/${{ item.id }}', concurrency: 0 },
      [{ id: 1 }],
      {},
    )).rejects.toBeInstanceOf(ArgumentError);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('stringifies non-Error batch browser failures consistently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up'));

    const page = {
      evaluate: vi.fn(async (js: string) => Function(`return (${js})`)()()),
    } as unknown as IPage;

    await expect(stepFetch(
      page,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }],
      {},
    )).resolves.toEqual([
      { error: 'socket hang up' },
    ]);
  });

  it('stringifies non-Error batch non-browser failures consistently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up'));

    await expect(stepFetch(
      null,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }],
      {},
    )).resolves.toEqual([
      { error: 'socket hang up' },
    ]);
  });

  // W2: batch item failures emit a warning log
  it('logs a warning for each failed batch item in non-browser mode', async () => {
    const { log } = await import('../../logger.js');
    const warnSpy = vi.spyOn(log, 'warn');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: vi.fn(),
    }));

    await stepFetch(
      null,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }, { id: 2 }],
      {},
    );

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('https://api.example.com/items/1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('https://api.example.com/items/2'));
  });

  it('logs a warning for each failed batch item in browser mode', async () => {
    const { log } = await import('../../logger.js');
    const warnSpy = vi.spyOn(log, 'warn');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: vi.fn(),
    }));

    const page = {
      evaluate: vi.fn(async (js: string) => Function(`return (${js})`)()()),
    } as unknown as IPage;

    await stepFetch(
      page,
      { url: 'https://api.example.com/items/${{ item.id }}' },
      [{ id: 1 }, { id: 2 }],
      {},
    );

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('https://api.example.com/items/1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('https://api.example.com/items/2'));
  });
});
