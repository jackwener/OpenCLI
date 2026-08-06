import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeFetchMock = vi.hoisted(() => vi.fn());
const undiciFetchMock = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  Agent: class Agent {},
  EnvHttpProxyAgent: class EnvHttpProxyAgent {},
  fetch: undiciFetchMock,
}));

vi.stubGlobal('fetch', nativeFetchMock);

const { decideProxy, fetchWithNodeNetwork, hasProxyEnv } = await import('./node-network.js');

afterEach(() => {
  vi.unstubAllEnvs();
  nativeFetchMock.mockReset();
  undiciFetchMock.mockReset();
});

describe('node network proxy decisions', () => {
  it('detects common proxy env variables', () => {
    expect(hasProxyEnv({ https_proxy: 'http://127.0.0.1:7897' })).toBe(true);
    expect(hasProxyEnv({ HTTP_PROXY: 'http://proxy.example:8080' })).toBe(true);
    expect(hasProxyEnv({})).toBe(false);
  });

  it('routes external https traffic through https_proxy', () => {
    const decision = decideProxy(
      new URL('https://www.v2ex.com/api/topics/latest.json'),
      { https_proxy: 'http://127.0.0.1:7897' },
    );

    expect(decision).toEqual({
      mode: 'proxy',
      proxyUrl: 'http://127.0.0.1:7897',
    });
  });

  it('falls back to HTTP_PROXY for https traffic when HTTPS_PROXY is absent', () => {
    const decision = decideProxy(
      new URL('https://www.v2ex.com/api/topics/latest.json'),
      { HTTP_PROXY: 'http://127.0.0.1:7897' },
    );

    expect(decision).toEqual({
      mode: 'proxy',
      proxyUrl: 'http://127.0.0.1:7897',
    });
  });

  it('bypasses proxies for loopback addresses', () => {
    const env = { https_proxy: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897' };

    expect(decideProxy(new URL('http://127.0.0.1:19825/status'), env)).toEqual({ mode: 'direct' });
    expect(decideProxy(new URL('http://localhost:19825/status'), env)).toEqual({ mode: 'direct' });
    expect(decideProxy(new URL('http://[::1]:19825/status'), env)).toEqual({ mode: 'direct' });
  });

  it('honors NO_PROXY domain matches', () => {
    const decision = decideProxy(
      new URL('https://api.example.com/v1/items'),
      {
        https_proxy: 'http://127.0.0.1:7897',
        no_proxy: '.example.com',
      },
    );

    expect(decision).toEqual({ mode: 'direct' });
  });

  it('supports wildcard-style NO_PROXY subdomain entries', () => {
    const decision = decideProxy(
      new URL('https://api.example.com/v1/items'),
      {
        https_proxy: 'http://127.0.0.1:7897',
        no_proxy: '*.example.com',
      },
    );

    expect(decision).toEqual({ mode: 'direct' });
  });

  it('matches NO_PROXY entries that rely on the default URL port', () => {
    const env = { https_proxy: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897' };

    expect(decideProxy(
      new URL('https://example.com/'),
      { ...env, NO_PROXY: 'example.com:443' },
    )).toEqual({ mode: 'direct' });

    expect(decideProxy(
      new URL('http://example.com/health'),
      { ...env, NO_PROXY: 'example.com:80' },
    )).toEqual({ mode: 'direct' });
  });

  it('falls back to ALL_PROXY when protocol-specific settings are absent', () => {
    const decision = decideProxy(
      new URL('http://example.net/data'),
      { ALL_PROXY: 'socks5://127.0.0.1:1080' },
    );

    expect(decision).toEqual({
      mode: 'proxy',
      proxyUrl: 'socks5://127.0.0.1:1080',
    });
  });

  it('uses native fetch for loopback URLs even when proxy env vars exist', async () => {
    const response = new Response('direct');
    nativeFetchMock.mockResolvedValue(response);
    undiciFetchMock.mockResolvedValue(new Response('proxied'));

    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:7897');
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');

    const result = await fetchWithNodeNetwork('http://127.0.0.1:19825/status');

    expect(result).toBe(response);
    expect(nativeFetchMock).toHaveBeenCalledTimes(1);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });
});
