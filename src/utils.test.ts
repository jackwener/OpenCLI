import { describe, it, expect } from 'vitest';
import {
  parseJsonOrThrowLoginWall,
  throwIfLoginWall,
  BROWSER_JSON_SNIFF_FN,
  type LoginWallSignal,
} from './utils.js';
import { LoginWallError } from './errors.js';

function makeResponse(body: string, opts: { status?: number; contentType?: string; url?: string } = {}): Response {
  return new Response(body, {
    status: opts.status ?? 200,
    headers: { 'content-type': opts.contentType ?? 'application/json' },
  });
}

describe('parseJsonOrThrowLoginWall', () => {
  it('returns parsed JSON on a normal application/json response', async () => {
    const res = makeResponse(JSON.stringify({ hello: 'world', n: 42 }));
    const parsed = await parseJsonOrThrowLoginWall(res);
    expect(parsed).toEqual({ hello: 'world', n: 42 });
  });

  it('throws LoginWallError when content-type is text/html', async () => {
    const res = makeResponse('<html><body>Please log in</body></html>', {
      status: 401,
      contentType: 'text/html; charset=utf-8',
    });
    await expect(parseJsonOrThrowLoginWall(res, { url: 'https://example.com/api' })).rejects.toMatchObject({
      name: 'LoginWallError',
      code: 'LOGIN_WALL',
      status: 401,
      url: 'https://example.com/api',
    });
  });

  it('throws LoginWallError when body starts with <!DOCTYPE even if content-type is missing', async () => {
    // application/json content-type but body is actually HTML — WAFs sometimes do this
    const res = new Response('<!DOCTYPE html><html><head></head><body>blocked</body></html>', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    try {
      await parseJsonOrThrowLoginWall(res, { url: 'https://x.com/api/list' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LoginWallError);
      const e = err as LoginWallError;
      expect(e.status).toBe(200);
      expect(e.url).toBe('https://x.com/api/list');
      expect(e.bodyPreview.startsWith('<!DOCTYPE')).toBe(true);
      expect(e.exitCode).toBe(77); // NOPERM
    }
  });

  it('throws LoginWallError when body starts with <html (no DOCTYPE)', async () => {
    const res = new Response('<html lang="en"><body>nope</body></html>', {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseJsonOrThrowLoginWall(res)).rejects.toBeInstanceOf(LoginWallError);
  });

  it('detects mixed-case HTML tags when content-type claims JSON', async () => {
    const res = new Response('<HtMl lang="en"><body>nope</body></HtMl>', {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseJsonOrThrowLoginWall(res)).rejects.toBeInstanceOf(LoginWallError);
  });

  it('detects mixed-case HTML fragments without a top-level html tag', async () => {
    for (const html of ['<BoDy>blocked</BoDy>', '<TiTlE>login</TiTlE>']) {
      const res = new Response(html, {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });

      await expect(parseJsonOrThrowLoginWall(res)).rejects.toBeInstanceOf(LoginWallError);
    }
  });

  it('does not treat arbitrary angle-prefixed non-HTML text as a login wall', async () => {
    const res = new Response('<htmlish', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseJsonOrThrowLoginWall(res)).rejects.not.toBeInstanceOf(LoginWallError);
  });

  it('throws LoginWallError when body has leading whitespace before <!DOCTYPE', async () => {
    const res = new Response('   \n\n<!DOCTYPE html><html></html>', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    await expect(parseJsonOrThrowLoginWall(res)).rejects.toBeInstanceOf(LoginWallError);
  });

  it('throws a regular Error (NOT LoginWallError) on real malformed JSON', async () => {
    const res = makeResponse('{not really json,');
    try {
      await parseJsonOrThrowLoginWall(res);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(LoginWallError);
      const msg = (err as Error).message;
      expect(msg).toContain('JSON parse failed');
      expect(msg).toContain('body[0..50]=');
      // body preview must be present so debugging doesn't require a repro
      expect(msg).toContain('not really json');
    }
  });

  it('preserves first 100 chars of body in bodyPreview', async () => {
    const longHtml = '<!DOCTYPE html><html><head><title>' + 'x'.repeat(500) + '</title></head></html>';
    const res = new Response(longHtml, { status: 403, headers: { 'content-type': 'text/html' } });
    try {
      await parseJsonOrThrowLoginWall(res);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as LoginWallError;
      expect(e.bodyPreview.length).toBe(100);
      expect(e.bodyPreview.startsWith('<!DOCTYPE')).toBe(true);
    }
  });
});

describe('throwIfLoginWall', () => {
  it('returns the value unchanged when it is not a login-wall sentinel', () => {
    const data = { data: { foo: 'bar' } };
    expect(throwIfLoginWall(data)).toBe(data);
    expect(throwIfLoginWall('hello')).toBe('hello');
    expect(throwIfLoginWall(null)).toBe(null);
    expect(throwIfLoginWall(undefined)).toBe(undefined);
    expect(throwIfLoginWall(42)).toBe(42);
    expect(throwIfLoginWall([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('returns objects that happen to have unrelated __loginWall-ish keys unchanged', () => {
    // Must NOT trigger on partial matches — sentinel needs __loginWall === true AND numeric status
    expect(throwIfLoginWall({ __loginWall: false })).toEqual({ __loginWall: false });
    expect(throwIfLoginWall({ __loginWall: true })).toEqual({ __loginWall: true }); // missing status → not a real sentinel
  });

  it('throws LoginWallError when value is the browser-side sentinel', () => {
    const signal: LoginWallSignal = {
      __loginWall: true,
      status: 403,
      url: 'https://x.com/i/api/graphql/...',
      contentType: 'text/html',
      bodyPreview: '<!DOCTYPE html><html><head><title>Login</title>',
    };
    try {
      throwIfLoginWall(signal);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LoginWallError);
      const e = err as LoginWallError;
      expect(e.status).toBe(403);
      expect(e.url).toBe('https://x.com/i/api/graphql/...');
      expect(e.bodyPreview).toContain('<!DOCTYPE');
      expect(e.code).toBe('LOGIN_WALL');
    }
  });

  it('opts.url overrides the URL embedded in the sentinel', () => {
    const signal: LoginWallSignal = {
      __loginWall: true,
      status: 401,
      url: '',
      contentType: 'text/html',
      bodyPreview: '<html>',
    };
    try {
      throwIfLoginWall(signal, { url: 'https://override.example.com/api' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as LoginWallError).url).toBe('https://override.example.com/api');
    }
  });
});

describe('BROWSER_JSON_SNIFF_FN', () => {
  it('is a non-empty string that defines fetchJsonOrLoginWall', () => {
    expect(typeof BROWSER_JSON_SNIFF_FN).toBe('string');
    expect(BROWSER_JSON_SNIFF_FN).toContain('fetchJsonOrLoginWall');
    expect(BROWSER_JSON_SNIFF_FN).toContain('__loginWall');
  });

  it('can be evaluated as JS without syntax errors', () => {
    // We can't run the actual fetch path here (no Response polyfill loop), but
    // we CAN confirm the fragment parses cleanly when embedded inside an async IIFE.
    expect(() => new Function(`(async () => { ${BROWSER_JSON_SNIFF_FN} })`)).not.toThrow();
  });

  it('detects mixed-case HTML tags in browser-side responses', async () => {
    const fetchJsonOrLoginWall = new Function(
      'fetch',
      `${BROWSER_JSON_SNIFF_FN}; return fetchJsonOrLoginWall;`,
    )(
      async () => new Response('<HtMl><body>login</body></HtMl>', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ) as (input: string) => Promise<LoginWallSignal>;

    await expect(fetchJsonOrLoginWall('/api')).resolves.toMatchObject({
      __loginWall: true,
      status: 403,
    });
  });

  it('detects mixed-case HTML fragments in browser-side responses', async () => {
    const fetchJsonOrLoginWall = new Function(
      'fetch',
      `${BROWSER_JSON_SNIFF_FN}; return fetchJsonOrLoginWall;`,
    )(
      async () => new Response('<BoDy>login</BoDy>', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ) as (input: string) => Promise<LoginWallSignal>;

    await expect(fetchJsonOrLoginWall('/api')).resolves.toMatchObject({
      __loginWall: true,
      status: 403,
    });
  });

  it('does not flag browser-side non-HTML angle-prefixed text', async () => {
    const fetchJsonOrLoginWall = new Function(
      'fetch',
      `${BROWSER_JSON_SNIFF_FN}; return fetchJsonOrLoginWall;`,
    )(
      async () => new Response('<htmlish', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as (input: string) => Promise<LoginWallSignal>;

    await expect(fetchJsonOrLoginWall('/api')).rejects.toThrow('JSON parse failed');
  });
});
