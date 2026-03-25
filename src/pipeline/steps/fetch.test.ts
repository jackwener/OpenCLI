import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { stepFetch } from './fetch.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stepFetch', () => {
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

  // W1 + W3: browser single fetch returns error status from evaluate, outer code throws CliError
  it('throws CliError with FETCH_ERROR code on non-ok responses inside the browser session', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'auth required' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    // Simulate real CDP behavior: evaluate returns a value, errors are thrown outside
    const page = {
      evaluate: vi.fn(async (js: string) => Function(`return (${js})`)()()),
    } as unknown as IPage;

    const err = await stepFetch(page, { url: 'https://api.example.com/items' }, null, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('FETCH_ERROR');
    expect((err as CliError).message).toBe('HTTP 401 Unauthorized from https://api.example.com/items');
    expect(jsonMock).not.toHaveBeenCalled();
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
