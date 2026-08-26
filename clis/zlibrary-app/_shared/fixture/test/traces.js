/**
 * Synthetic DownloadTraceV2 fixture factory for doctor --download tests.
 *
 * Generates 9 fixture types covering success and every known failure mode.
 * Each fixture conforms to the DownloadTraceV2 schema from contracts.js.
 *
 * @module traces
 */

/**
 * Build minimal DownloadTraceV2-like fixture for testing.
 *
 * @param {object} overrides - Partial trace fields to merge.
 * @returns {object} - Synthetic fixture object.
 */
export function buildMinimalTrace(overrides) {
  var base = {
    schemaVersion: 2,
    fixtureKind: 'zlibrary-app.electron-cdp-download',
    command: 'download',
    capturedAt: '2026-06-28T00:00:00.000Z',
    book: { bookId: 'test-book-001', title: 'Test Book', format: 'epub' },
    browserContext: { origin: 'https://z-lib.gl', userAgent: 'Mozilla/5.0' },
    capability: { fetchViaCDP: true },
    trigger: { urlRelative: '/dl/token123', referer: 'https://z-lib.gl/book/123' },
    requestChain: [],
    transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: '', browserDownloadEventSeen: false },
    artifact: { tempPath: '', fileSize: 0, md5: '', contentType: '', source: { transport: 'electron-cdp-fetch', finalUrl: '', cdnMd5: '' } },
    validation: { cdnMd5Status: '', htmlDetected: false, durationMs: 0 },
    error: null,
  }
  return mergeDeep(base, overrides)
}

/**
 * Deep-merge objects (2-level max for trace fixtures).
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function mergeDeep(target, source) {
  var result = {}
  for (var k in target) result[k] = target[k]
  if (!source || typeof source !== 'object') return result
  for (var k in source) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k]) && target[k] && typeof target[k] === 'object') {
      result[k] = mergeDeep(target[k], source[k])
    } else {
      result[k] = source[k]
    }
  }
  return result
}

/** @returns {object} - Success trace: 302→302→200 CDN, artifact > 4KB */
export function createSuccessFixture() {
  return buildMinimalTrace({
    book: { bookId: 'success-001', title: 'Success Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/token123', status: 302, type: 'Fetch' },
      { url: 'https://z-lib.gl/dl/redirected', status: 302, type: 'Fetch' },
      { url: 'https://cdn.z-lib.gl/books/abc123/file.epub?filename=book.epub&md5=d41d8cd98f00b204e9800998ecf8427e', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 65536, chunks: 4, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_abc.epub', fileSize: 65536, md5: 'd41d8cd98f00b204e9800998ecf8427e', contentType: 'application/epub+zip', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://cdn.z-lib.gl/books/abc123/file.epub?filename=book.epub&md5=d41d8cd98f00b204e9800998ecf8427e', cdnMd5: 'd41d8cd98f00b204e9800998ecf8427e' } },
    validation: { cdnMd5Status: 'matched', htmlDetected: false, durationMs: 2500 },
  })
}

/** @returns {object} - 204 gate fixture: first /dl hop returns 204 */
export function create204GateFixture() {
  return buildMinimalTrace({
    book: { bookId: '204-gate-001', title: '204 Gate Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/token204', status: 204, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: 'Aborted', browserDownloadEventSeen: false },
    artifact: { tempPath: '', fileSize: 0, md5: '', contentType: '', source: { transport: 'electron-cdp-fetch', finalUrl: '', cdnMd5: '' } },
    validation: { cdnMd5Status: '', htmlDetected: false, durationMs: 800 },
    error: { phase: 'response', type: 'HTTPError', message: 'Server returned HTTP 204 No Content', statusCode: 204, statusMessage: 'No Content' },
  })
}

/** @returns {object} - 403 quota/auth fixture */
export function create403Fixture() {
  return buildMinimalTrace({
    book: { bookId: '403-auth-001', title: 'Auth Fail Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/token403', status: 403, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: 'Aborted', browserDownloadEventSeen: false },
    artifact: { tempPath: '', fileSize: 0, md5: '', contentType: '', source: { transport: 'electron-cdp-fetch', finalUrl: '', cdnMd5: '' } },
    validation: { cdnMd5Status: '', htmlDetected: false, durationMs: 600 },
    error: { phase: 'response', type: 'HTTPError', message: 'Server returned HTTP 403 Forbidden', statusCode: 403, statusMessage: 'Forbidden' },
  })
}

/** @returns {object} - HTML block fixture: CDN 200 but content is block page */
export function createHtmlBlockFixture() {
  return buildMinimalTrace({
    book: { bookId: 'html-block-001', title: 'Block Page Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenBlock', status: 302, type: 'Fetch' },
      { url: 'https://cdn.z-lib.gl/block.html', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 8192, chunks: 1, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_block.html', fileSize: 8192, md5: 'abc123def456', contentType: 'text/html', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://cdn.z-lib.gl/block.html', cdnMd5: '' } },
    validation: { cdnMd5Status: 'unavailable', htmlDetected: true, durationMs: 1200 },
  })
}

/** @returns {object} - No CDN redirect fixture: /dl hop but no CDN final host */
export function createNoCdnFixture() {
  return buildMinimalTrace({
    book: { bookId: 'nocdn-001', title: 'No CDN Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenNoCdn', status: 302, type: 'Fetch' },
      { url: 'https://z-lib.gl/dl/redirected2', status: 302, type: 'Fetch' },
      { url: 'https://z-lib.gl/dl/final', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 512, chunks: 1, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_nocdn.epub', fileSize: 512, md5: 'abc', contentType: 'application/octet-stream', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://z-lib.gl/dl/final', cdnMd5: '' } },
    validation: { cdnMd5Status: 'unavailable', htmlDetected: false, durationMs: 900 },
  })
}

/** @returns {object} - MD5 mismatch fixture: computed md5 != cdnMd5 */
export function createMd5MismatchFixture() {
  return buildMinimalTrace({
    book: { bookId: 'md5-bad-001', title: 'MD5 Mismatch Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenMd5', status: 302, type: 'Fetch' },
      { url: 'https://cdn.z-lib.gl/books/wrong/file.epub', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 65536, chunks: 4, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_md5bad.epub', fileSize: 65536, md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', contentType: 'application/epub+zip', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://cdn.z-lib.gl/books/wrong/file.epub', cdnMd5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } },
    validation: { cdnMd5Status: 'mismatched', htmlDetected: false, durationMs: 3200 },
  })
}

/** @returns {object} - Zero stream fixture: CDN 200 but streamBytes=0 */
export function createZeroStreamFixture() {
  return buildMinimalTrace({
    book: { bookId: 'zero-stream-001', title: 'Zero Stream Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenZero', status: 302, type: 'Fetch' },
      { url: 'https://cdn.z-lib.gl/books/empty', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_empty.epub', fileSize: 0, md5: '', contentType: '', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://cdn.z-lib.gl/books/empty', cdnMd5: '' } },
    validation: { cdnMd5Status: 'unavailable', htmlDetected: false, durationMs: 500 },
    error: { phase: 'io', type: 'StreamError', message: 'Stream closed with 0 bytes', statusCode: 0, statusMessage: '' },
  })
}

/**
 * @returns {object} - Insufficient fixture: schema-valid but missing classification fields.
 * Has requestChain but no transport.streamBytes and no error details.
 */
export function createInsufficientFixture() {
  return buildMinimalTrace({
    book: { bookId: 'insufficient-001', title: 'Insufficient Book', format: 'epub' },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenX', status: 0, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: '', browserDownloadEventSeen: false },
    artifact: { tempPath: '', fileSize: 0, md5: '', contentType: '', source: { transport: 'electron-cdp-fetch', finalUrl: '', cdnMd5: '' } },
    validation: { cdnMd5Status: '', htmlDetected: false, durationMs: 0 },
    error: null,
  })
}

/**
 * @returns {object} - Secret-bearing fixture: trigger contains cookies to test no-leak.
 */
export function createSecretFixture() {
  return buildMinimalTrace({
    book: { bookId: 'secret-001', title: 'Secret Book', format: 'epub' },
    trigger: {
      urlRelative: '/dl/tokenSecret',
      referer: 'https://z-lib.gl/book/123',
      cookies: [{ name: 'session', value: 's3cr3t_t0k3n_v4lu3', domain: 'z-lib.gl' }],
    },
    requestChain: [
      { url: 'https://z-lib.gl/dl/tokenSecret', status: 302, type: 'Fetch' },
      { url: 'https://cdn.z-lib.gl/books/secret/file.epub', status: 200, type: 'Fetch' },
    ],
    transport: { name: 'electron-cdp-fetch', streamBytes: 65536, chunks: 2, suppressAction: 'fulfill', browserDownloadEventSeen: true },
    artifact: { tempPath: '/tmp/download_secret.epub', fileSize: 65536, md5: 'secretmd51234567890123456789012', contentType: 'application/epub+zip', source: { transport: 'electron-cdp-fetch', finalUrl: 'https://cdn.z-lib.gl/books/secret/file.epub', cdnMd5: 'secretmd51234567890123456789012' } },
    validation: { cdnMd5Status: 'matched', htmlDetected: false, durationMs: 2000 },
  })
}
