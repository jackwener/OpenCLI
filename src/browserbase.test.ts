import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBrowserbaseSessionId, validateBrowserbaseSession } from './browserbase.js';

describe('browserbase session helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves the CLI session before the environment fallback', () => {
    vi.stubEnv('BROWSERBASE_SESSION_ID', 'env-session');

    expect(resolveBrowserbaseSessionId('cli-session')).toBe('cli-session');
    expect(resolveBrowserbaseSessionId()).toBe('env-session');
    expect(resolveBrowserbaseSessionId('   ')).toBe('env-session');
  });

  it('validates a running session and returns the connect URL', async () => {
    vi.stubEnv('BROWSERBASE_API_KEY', 'bb-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: 'RUNNING',
        connectUrl: 'wss://connect.browserbase.example/devtools',
      })),
    );

    await expect(validateBrowserbaseSession('sess_123')).resolves.toEqual({
      id: 'sess_123',
      status: 'RUNNING',
      connectUrl: 'wss://connect.browserbase.example/devtools',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.browserbase.com/v1/sessions/sess_123',
      { headers: { 'x-bb-api-key': 'bb-key' } },
    );
  });

  it('rejects missing API key before calling Browserbase', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(validateBrowserbaseSession('sess_123')).rejects.toThrow('BROWSERBASE_API_KEY not set');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
