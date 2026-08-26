import { describe, expect, it } from 'vitest';
import { DownloadFixtureRecorder, buildFixtureFilename } from '../fixture/index.js';
import { validateDownloadTraceV2 } from './contracts.js';

describe('DownloadFixtureRecorder', () => {
  it('should create DownloadTraceV2 schema by default', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'booklist-download',
      bookId: '123',
      outputDir: '/tmp'
    });

    expect(recorder.data.schemaVersion).toBe(2);
    expect(recorder.data.fixtureKind).toBe('zlibrary-app.electron-cdp-download');
    expect(recorder.data.requestChain).toEqual([]);
    expect(recorder.data.transport).toBeDefined();
    expect(recorder.data.artifact).toBeDefined();
    expect(recorder.data.validation).toBeDefined();
    expect(recorder.data.capability).toBeDefined();
    // Old field names removed — no browser, request, responses, cdpNetwork, download, timing
    expect(recorder.data.browser).toBeUndefined();
    expect(recorder.data.browserContext).toBeDefined();
    expect(recorder.data.timing).toBeUndefined();
  });

  it('should record CDP network entries via recordCdpNetwork as requestChain hops', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'booklist-download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordCdpNetwork({
      event: 'dl_paused',
      requestUrl: 'https://z-library.im/dl/token123',
      requestMethod: 'GET',
      statusCode: 302,
      requestId: 'req1',
      timestamp: Date.now()
    });

    recorder.recordCdpNetwork({
      event: 'cdn_200',
      requestUrl: 'https://cdn.example.com/file.epub',
      statusCode: 200,
      timestamp: Date.now()
    });

    expect(recorder.data.requestChain).toHaveLength(2);
    expect(recorder.data.requestChain[0].url).toBe('https://z-library.im/dl/token123');
    expect(recorder.data.requestChain[0].status).toBe(302);
    expect(recorder.data.requestChain[0].type).toBe('Navigation');
    expect(recorder.data.requestChain[0].redirectedTo).toBe('https://cdn.example.com/file.epub');
    expect(recorder.data.requestChain[1].status).toBe(200);
    expect(recorder.data.requestChain[1].type).toBe('Fetch');
    expect(recorder.data.requestChain[1].redirectedFrom).toBe('https://z-library.im/dl/token123');
  });

  it('should extract transport trace from stream_done CDP event', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordCdpNetwork({
      event: 'stream_done',
      totalBytes: 1048576,
      chunks: 32,
      md5: 'a1b2c3d4e5f67890abcdef1234567890',
      suppressAction: 'Aborted',
      timestamp: Date.now(),
    });

    expect(recorder.data.transport.streamBytes).toBe(1048576);
    expect(recorder.data.transport.chunks).toBe(32);
    expect(recorder.data.transport.suppressAction).toBe('Aborted');
    expect(recorder.data.artifact.md5).toBe('a1b2c3d4e5f67890abcdef1234567890');
  });

  it('should record transport trace via recordTransportTrace', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordTransportTrace({
      streamBytes: 2048,
      chunks: 5,
      suppressAction: 'Aborted',
      browserDownloadEventSeen: true,
    });

    expect(recorder.data.transport.streamBytes).toBe(2048);
    expect(recorder.data.transport.chunks).toBe(5);
    expect(recorder.data.transport.suppressAction).toBe('Aborted');
    expect(recorder.data.transport.browserDownloadEventSeen).toBe(true);
  });

  it('should record download result into artifact and validation', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordDownloadResult({
      filename: 'test.epub',
      finalPath: '/tmp/test.epub',
      fileSizeBytes: 1048576,
      md5: 'a1b2c3d4e5f67890abcdef1234567890',
      cdnMd5: 'a1b2c3d4e5f67890abcdef1234567890',
      cdnMd5Verified: true,
    });

    expect(recorder.data.artifact.fileSize).toBe(1048576);
    expect(recorder.data.artifact.md5).toBe('a1b2c3d4e5f67890abcdef1234567890');
    expect(recorder.data.artifact.tempPath).toBe('/tmp/test.epub');
    expect(recorder.data.artifact.filename).toBe('test.epub');
    expect(recorder.data.validation.cdnMd5).toBe('a1b2c3d4e5f67890abcdef1234567890');
    expect(recorder.data.validation.cdnMd5Verified).toBe(true);
  });

  it('should redact request url and cookie header case-insensitively', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordRequest({
      method: 'GET',
      url: 'https://z-library.im/dl/secretToken123',
      headers: {
        cookie: 'sid=secret',
      },
    });

    expect(recorder.data.trigger.url).toBe('https://z-library.im/dl/...');
    expect(recorder.data.trigger.headers.cookie).toContain('[REDACTED: 0 cookies]');
  });

  it('should record book metadata via recordBook', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordBook({
      bookId: '41519811',
      title: 'Test Book',
      author: 'Test Author',
      extension: 'epub',
    });

    expect(recorder.data.book.bookId).toBe('41519811');
    expect(recorder.data.book.title).toBe('Test Book');
    expect(recorder.data.book.author).toBe('Test Author');
    expect(recorder.data.book.extension).toBe('epub');
  });

  it('should record browser context via recordBrowserContext', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordBrowserContext({
      url: 'https://z-library.im/book/123',
      origin: 'https://z-library.im',
      userAgent: 'Mozilla/5.0 (...Chrome/147...)',
      language: 'en-US',
    });

    expect(recorder.data.browserContext.url).toBe('https://z-library.im/book/123');
    expect(recorder.data.browserContext.origin).toBe('https://z-library.im');
    expect(recorder.data.browserContext.userAgent).toBe('Mozilla/5.0 (...Chrome/147...)');
    expect(recorder.data.browserContext.language).toBe('en-US');
  });

  it('should produce valid DownloadTraceV2 via toDownloadTraceV2', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordBrowserContext({
      url: 'https://z-library.im/book/123',
      origin: 'https://z-library.im',
      userAgent: 'Mozilla/5.0',
    });

    recorder.recordCdpNetwork({
      event: 'dl_paused',
      requestUrl: 'https://z-library.im/dl/token123',
      statusCode: 302,
      timestamp: Date.now(),
    });

    recorder.recordCdpNetwork({
      event: 'cdn_200',
      requestUrl: 'https://cdn.example.com/file.epub',
      statusCode: 200,
      timestamp: Date.now(),
    });

    recorder.recordCdpNetwork({
      event: 'stream_done',
      totalBytes: 1024,
      chunks: 2,
      md5: 'a1b2c3d4e5f67890abcdef1234567890',
      suppressAction: 'Aborted',
      timestamp: Date.now(),
    });

    recorder.recordDownloadResult({
      filename: 'test.epub',
      finalPath: '/tmp/test.epub',
      fileSizeBytes: 1024,
      md5: 'a1b2c3d4e5f67890abcdef1234567890',
      cdnMd5: 'a1b2c3d4e5f67890abcdef1234567890',
      cdnMd5Verified: true,
    });

    const trace = recorder.toDownloadTraceV2();
    expect(trace.schemaVersion).toBe(2);
    expect(trace.fixtureKind).toBe('zlibrary-app.electron-cdp-download');
    expect(trace.browserContext.origin).toBe('https://z-library.im');
    expect(trace.requestChain).toHaveLength(2);

    // Validate via contracts
    const validation = validateDownloadTraceV2(trace);
    expect(validation.valid).toBe(true);
  });

  it('should record error with structured metadata', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'booklist-download',
      bookId: '123',
      outputDir: '/tmp'
    });

    const err = new Error('Download failed with HTTP 204');
    err.statusCode = 204;
    err.statusMessage = 'No Content';
    err.responseHeaders = { 'content-type': 'text/html' };
    err.errorType = 'download_engine_gated';
    err.downloadUrl = 'https://z-library.im/dl/token123';

    recorder.recordError(err, 'download');

    expect(recorder.data.error.phase).toBe('download');
    expect(recorder.data.error.type).toBe('Error');
    expect(recorder.data.error.message).toBe('Download failed with HTTP 204');
    expect(recorder.data.error.statusCode).toBeUndefined();
    expect(recorder.data.error.errorType).toBeUndefined();
    expect(recorder.data.error.downloadUrl).toBeUndefined();
  });

  describe('buildFixtureFilename  -  path traversal prevention', () => {
    it('should sanitise dot-dot-slash in bookId', () => {
      const ts = '2026-06-22T12:00:00.000Z';
      const result = buildFixtureFilename('booklist-download', '../../../etc/passwd', ts);
      expect(result).not.toContain('..');
      expect(result).not.toContain('/');
      expect(result).toContain('___etc_passwd');
    });

    it('should allow normal book IDs', () => {
      const ts = '2026-06-22T12:00:00.000Z';
      const result = buildFixtureFilename('booklist-download', '12345', ts);
      expect(result).toContain('12345');
    });

    it('should allow alpha-numeric book IDs', () => {
      const ts = '2026-06-22T12:00:00.000Z';
      const result = buildFixtureFilename('booklist-download', 'book-abc_123', ts);
      expect(result).toContain('book-abc_123');
    });

    it('should handle null/undefined bookId gracefully', () => {
      const ts = '2026-06-22T12:00:00.000Z';
      const result = buildFixtureFilename('booklist-download', null, ts);
      expect(result).toContain('null');
      expect(result).not.toContain('/');
    });
  });

  it('should record multiple CDP entries as requestChain hops', () => {
    const recorder = new DownloadFixtureRecorder({
      enabled: true,
      command: 'booklist-download',
      bookId: '123',
      outputDir: '/tmp'
    });

    recorder.recordCdpNetwork({ event: 'dl_paused', requestUrl: 'https://z-library.im/dl/1', statusCode: 302 });
    recorder.recordCdpNetwork({ event: 'redirect_hop', fromUrl: 'https://cdn.example.com/redirect', statusCode: 302 });
    recorder.recordCdpNetwork({ event: 'cdn_200', requestUrl: 'https://cdn.example.com/1', statusCode: 200 });

    expect(recorder.data.requestChain).toHaveLength(3);
    expect(recorder.data.requestChain[0].status).toBe(302);
    expect(recorder.data.requestChain[1].type).toBe('Redirect');
    expect(recorder.data.requestChain[2].status).toBe(200);
    expect(recorder.data.requestChain[2].type).toBe('Fetch');
  });
});
