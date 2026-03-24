import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCookieHeader, httpDownload, resolveRedirectUrl } from './index.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  })));
  servers.length = 0;
});

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('download helpers', () => {
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

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-download-'));
    const destPath = path.join(tempDir, 'file.txt');
    const result = await httpDownload(`${baseUrl}/loop`, destPath, { maxRedirects: 2 });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      size: 0,
      error: 'Too many redirects (> 2)',
    }));
    expect(fs.existsSync(destPath)).toBe(false);
  });
});
