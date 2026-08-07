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

  // A URL whose only mention of "item" is the path segment (not an ${{ item }}
  // binding) must NOT fan out per array element: a single fetch, object result.
  it('does not fan out per-item for a URL containing "item" without an item binding', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await stepFetch(
      null,
      { url: 'https://x/items' },
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      {},
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://x/items', { method: 'GET', headers: {} });
  });

  // A URL with an ${{ item.* }} binding DOES fan out: one fetch per array element.
  it('fans out per-item for a URL with an item binding', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await stepFetch(
      null,
      { url: 'https://x/items/${{ item.id }}' },
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      {},
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith('https://x/items/1', { method: 'GET', headers: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://x/items/2', { method: 'GET', headers: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://x/items/3', { method: 'GET', headers: {} });
  });

  // The `\b` word boundary must keep a plural/compound identifier such as
  // `items.length` from being read as the `item` binding: a single fetch, object result.
  it('does not fan out for a URL whose only "item" is the plural "items" identifier', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await stepFetch(
      null,
      { url: 'https://x/${{ items.length }}' },
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      {},
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // `items` is not a per-item binding, so it renders as a single fetch (the
    // unresolved expression stringifies to "undefined") — crucially, NOT N fetches.
    expect(fetchMock).toHaveBeenCalledWith('https://x/undefined', { method: 'GET', headers: {} });
  });

  // `index` is a first-class per-item binding (template.ts resolvePath), so a URL
  // referencing only ${{ index }} over array data DOES fan out: one fetch per element.
  it('fans out per-item for a URL with an index binding (no item)', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await stepFetch(
      null,
      { url: 'https://x/page/${{ index }}' },
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      {},
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith('https://x/page/0', { method: 'GET', headers: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://x/page/1', { method: 'GET', headers: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://x/page/2', { method: 'GET', headers: {} });
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
