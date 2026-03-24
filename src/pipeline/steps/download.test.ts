/**
 * Tests for pipeline/steps/download.ts.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as downloadModule from '../../download/index.js';
import { executePipeline } from '../index.js';
import type { IPage } from '../../types.js';

const servers: http.Server[] = [];
const tempDirs: string[] = [];

/** Clean up temp servers and download directories after each test. */
afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  })));
  servers.length = 0;

  await Promise.all(tempDirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

/** Start a local HTTP server for download step tests. */
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

/** Create a minimal browser page mock for download step tests. */
function createMockPage(overrides: Partial<IPage> = {}): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(null),
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn(),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue(''),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

describe('stepDownload', () => {
  it('retries when anonymous fallback lands on an HTML login page', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.url === '/login') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 302;
        res.setHeader('Location', '/login');
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end('secret');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/protected.bin`,
          dir: downloadDir,
          filename: 'protected.bin',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'protected.bin'), 'utf8')).toBe('secret');
  });

  it('retries when the original URL returns a 200 HTML login page', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end('secret');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/protected.bin`,
          dir: downloadDir,
          filename: 'protected.bin',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'protected.bin'), 'utf8')).toBe('secret');
  });

  it('retries when a protected json URL returns a 200 HTML login page', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"secret":true}');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/protected.json`,
          dir: downloadDir,
          filename: 'protected.json',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'protected.json'), 'utf8')).toBe('{"secret":true}');
  });

  it('retries when a protected extensionless URL returns a 200 HTML login page', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end('secret');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/download/123`,
          dir: downloadDir,
          filename: 'file.bin',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'file.bin'), 'utf8')).toBe('secret');
  });

  it('retries when anonymous fallback gets a 404 for a protected file', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 404;
        res.end('missing');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end('secret');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/hidden.bin`,
          dir: downloadDir,
          filename: 'hidden.bin',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'hidden.bin'), 'utf8')).toBe('secret');
  });

  it('falls back to anonymous download when public files do not need cookies', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.end('public');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValue(new Error('Extension disconnected'));

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/public.txt`,
          dir: downloadDir,
          filename: 'public.txt',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(1);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'public.txt'), 'utf8')).toBe('public');
  });

  it('keeps successful anonymous fallback for public HTML without an extension', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<html><body>terms</body></html>');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValue(new Error('Extension disconnected'));

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/terms`,
          dir: downloadDir,
          filename: 'terms.html',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(1);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'terms.html'), 'utf8')).toContain('terms');
  });

  it('keeps successful anonymous fallback for public HTML with the default filename', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<html><body>terms</body></html>');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValue(new Error('Extension disconnected'));

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/terms`,
          dir: downloadDir,
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string; path?: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(1);
    expect(result[0]?._download.status).toBe('success');
    expect(result[0]?._download.path).toBeTruthy();
    expect(fs.readFileSync(result[0]!._download.path!, 'utf8')).toContain('terms');
  });

  it('keeps successful anonymous fallback for public HTML on a php route', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<html><body>terms</body></html>');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValue(new Error('Extension disconnected'));

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/terms.php`,
          dir: downloadDir,
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string; path?: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(1);
    expect(result[0]?._download.status).toBe('success');
    expect(result[0]?._download.path).toBeTruthy();
    expect(fs.readFileSync(result[0]!._download.path!, 'utf8')).toContain('terms');
  });

  it('retries when a protected php route returns a 200 HTML login page for a binary file', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end('secret');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/download.php?id=123`,
          dir: downloadDir,
          filename: 'file.bin',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'file.bin'), 'utf8')).toBe('secret');
  });

  it('retries when a document download returns a 200 HTML login page for a json file', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html>login</html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"secret":true}');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/protected.json`,
          dir: downloadDir,
          filename: 'protected.json',
          type: 'document',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'protected.json'), 'utf8')).toBe('{"secret":true}');
  });

  it('retries when browser cookie extraction fails with a transient disconnect', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.headers.cookie !== 'sid=abc') {
        res.statusCode = 403;
        res.end('forbidden');
        return;
      }

      res.statusCode = 200;
      res.end('ok');
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValue([{ name: 'sid', value: 'abc', domain: '127.0.0.1' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: `${baseUrl}/file.txt`,
          dir: downloadDir,
          filename: 'file.txt',
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(result[0]?._download.status).toBe('success');
    expect(fs.readFileSync(path.join(downloadDir, 'file.txt'), 'utf8')).toBe('ok');
  });

  it('retries yt-dlp cookie export when Netscape cookie extraction hits a transient disconnect', async () => {
    const ytdlpDownload = vi.spyOn(downloadModule, 'ytdlpDownload').mockResolvedValue({
      success: true,
      size: 1,
    });

    const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-pipeline-download-'));
    tempDirs.push(downloadDir);

    const getCookies = vi.fn()
      .mockRejectedValueOnce(new Error('Extension disconnected'))
      .mockResolvedValueOnce([{ name: 'sid', value: 'abc', domain: 'example.com' }]);

    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{}]),
      getCookies,
    });

    const result = await executePipeline(page, [
      { evaluate: '() => ([{}])' },
      {
        download: {
          url: 'https://example.com/video.mp4',
          dir: downloadDir,
          filename: 'video.mp4',
          use_ytdlp: true,
          progress: false,
        },
      },
    ], { args: {}, stepRetries: 2 }) as Array<{ _download: { status: string } }>;

    expect(getCookies).toHaveBeenCalledTimes(2);
    expect(ytdlpDownload).toHaveBeenCalledWith(
      'https://example.com/video.mp4',
      path.join(downloadDir, 'video.mp4'),
      expect.objectContaining({
        cookiesFile: expect.any(String),
      }),
    );
    expect(result[0]?._download.status).toBe('success');
  });
});
