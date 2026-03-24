import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { stepFetch } from './fetch.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stepFetch', () => {
  it('throws on non-ok HTTP responses without a browser session', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'rate limited' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(stepFetch(null, { url: 'https://api.example.com/items' }, null, {})).rejects.toThrow(
      'HTTP 429 Too Many Requests',
    );
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('throws on non-ok HTTP responses inside the browser session', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ error: 'auth required' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: jsonMock,
    });
    vi.stubGlobal('fetch', fetchMock);

    // Execute the injected browser-side function so the test observes the real fetch logic.
    const page = {
      evaluate: vi.fn(async (js: string) => Function(`return (${js})`)()()),
    } as unknown as IPage;

    await expect(stepFetch(page, { url: 'https://api.example.com/items' }, null, {})).rejects.toThrow(
      'HTTP 401 Unauthorized',
    );
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
});
