import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCookieHeader, httpDownload, resolveRedirectUrl } from './index.js';

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  })));
  servers.length = 0;
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

async function startServer(handler: http.RequestListener, hostname = '127.0.0.1'): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, hostname, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }
  return `http://${hostname}:${address.port}`;
}

// Windows Defender can briefly lock newly-written .tmp files, causing EPERM.
// Retry once to handle this flakiness.
describe('download helpers', { retry: process.platform === 'win32' ? 2 : 0 }, () => {
  it('resolves relative redirects against the original URL', () => {
    expect(resolveRedirectUrl('https://example.com/a/file', '/cdn/file.bin')).toBe('https://example.com/cdn/file.bin');
    expect(resolveRedirectUrl('https://example.com/a/file', '../next')).toBe('https://example.com/next');
  });

  it('formats browser cookies into a Cookie header', () => {
    expect(formatCookieHeader([
      { name: 'sid', value: 'abc', domain: 'example.com' },
      { name: 'ct0', value: 'def', domain: 'example.com' },
    ])).toBe('sid=abc; ct0=def');
  });

  it('fails after exceeding the redirect limit', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', '/loop');
      res.end();
    });

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-dl-'));
    tempDirs.push(tempDir);
    const destPath = path.join(tempDir, 'file.txt');
    const result = await httpDownload(`${baseUrl}/loop`, destPath, { maxRedirects: 2 });

    expect(result).toEqual({
      success: false,
      size: 0,
      error: 'Too many redirects (> 2)',
    });
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('does not forward cookies across cross-domain redirects', async () => {
    let forwardedCookie: string | undefined;
    const targetUrl = await startServer((req, res) => {
      forwardedCookie = req.headers.cookie;
      res.statusCode = 200;
      res.end('ok');
    }, 'localhost');

    const redirectUrl = await startServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', targetUrl);
      res.end();
    });

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-dl-'));
    tempDirs.push(tempDir);
    const destPath = path.join(tempDir, 'redirect.txt');
    const result = await httpDownload(`${redirectUrl}/start`, destPath, { cookies: 'sid=abc' });

    expect(result).toEqual({ success: true, size: 2 });
    expect(forwardedCookie).toBeUndefined();
    expect(fs.readFileSync(destPath, 'utf8')).toBe('ok');
  });

  it('does not forward cookie headers across cross-domain redirects', async () => {
    let forwardedCookie: string | undefined;
    const targetUrl = await startServer((req, res) => {
      forwardedCookie = req.headers.cookie;
      res.statusCode = 200;
      res.end('ok');
    }, 'localhost');

    const redirectUrl = await startServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', targetUrl);
      res.end();
    });

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-dl-'));
    tempDirs.push(tempDir);
    const destPath = path.join(tempDir, 'redirect-header.txt');
    const result = await httpDownload(`${redirectUrl}/start`, destPath, {
      headers: { Cookie: 'sid=header-cookie' },
    });

    expect(result).toEqual({ success: true, size: 2 });
    expect(forwardedCookie).toBeUndefined();
    expect(fs.readFileSync(destPath, 'utf8')).toBe('ok');
  });

  it('bypasses proxy settings for loopback downloads', async () => {
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:9');

    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-dl-'));
    tempDirs.push(tempDir);
    const destPath = path.join(tempDir, 'loopback.txt');
    const result = await httpDownload(`${baseUrl}/ok`, destPath);

    expect(result).toEqual({ success: true, size: 2 });
    expect(fs.readFileSync(destPath, 'utf8')).toBe('ok');
  });
});
