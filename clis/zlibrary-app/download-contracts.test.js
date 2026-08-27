import { describe, expect, it } from 'vitest'
import {
  validateDownloadRequest,
  buildDownloadArtifact,
  createDownloadTraceV2,
  sanitizeDownloadTraceUrl,
  toNonNegativeInteger,
  extractCdnMd5,
} from './_shared/book-download/contracts.js'

// ---------------------------------------------------------------------------
// validateDownloadRequest
// ---------------------------------------------------------------------------

describe('validateDownloadRequest', () => {
  const validRequest = {
    bookId: '41519811',
    urlRelative: '/dl/aZ6oR1kdj4',
    origin: 'https://1lib.sk',
    referer: 'https://1lib.sk/book/123',
    format: 'epub',
    outputDir: '/tmp/downloads',
    timeoutMs: 300000,
  }

  it('accepts valid request', () => {
    const result = validateDownloadRequest(validRequest)
    expect(result).toEqual({ valid: true })
  })

  it('accepts request without optional fields', () => {
    const minimal = {
      bookId: '123',
      urlRelative: '/dl/token123',
      origin: 'https://z-lib.org',
      outputDir: '/tmp/dl',
      format: 'epub',
    }
    expect(validateDownloadRequest(minimal)).toEqual({ valid: true })
  })

  it('rejects null', () => {
    expect(validateDownloadRequest(null)).toEqual({
      valid: false,
      error: 'DownloadRequest must be an object',
    })
  })

  it('rejects non-object', () => {
    expect(validateDownloadRequest('string')).toEqual({
      valid: false,
      error: 'DownloadRequest must be an object',
    })
  })

  it('rejects missing bookId', () => {
    const { bookId, ...rest } = validRequest
    expect(validateDownloadRequest(rest)).toEqual({
      valid: false,
      error: 'bookId must be a non-empty string',
    })
  })

  it('rejects urlRelative not starting with /dl/', () => {
    const r = { ...validRequest, urlRelative: '/book/123' }
    expect(validateDownloadRequest(r).valid).toBe(false)
  })

  it('rejects urlRelative containing scheme', () => {
    const r = { ...validRequest, urlRelative: 'https://evil.com/dl/token' }
    expect(validateDownloadRequest(r).valid).toBe(false)
  })

  it('rejects control characters in urlRelative', () => {
    const r = { ...validRequest, urlRelative: '/dl/token\x00\x1f' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('control characters')
  })

  it('rejects dot segments in urlRelative', () => {
    const r = { ...validRequest, urlRelative: '/dl/../etc/passwd' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('dot segments')
  })

  it('rejects encoded host-shaped path', () => {
    const r = { ...validRequest, urlRelative: '/dl/https://evil.com/token' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
  })

  it('rejects non-HTTP origin', () => {
    const { referer, ...noReferer } = validRequest
    const r = { ...noReferer, origin: 'file:///shell.html' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/origin/)
  })

  it('rejects http origin (not https)', () => {
    const { referer, ...noReferer } = validRequest
    const r = { ...noReferer, origin: 'http://1lib.sk' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('HTTPS')
  })

  it('rejects origin with path', () => {
    const { referer, ...noReferer } = validRequest
    const r = { ...noReferer, origin: 'https://1lib.sk/some/path' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('pure origin')
  })

  it('rejects invalid optional field types', () => {
    expect(validateDownloadRequest({ ...validRequest, filenameTemplate: 123 })).toEqual({
      valid: false,
      error: 'filenameTemplate must be a string when provided',
    })

    expect(validateDownloadRequest({ ...validRequest, metadata: { md5: 123 } })).toEqual({
      valid: false,
      error: 'metadata values must be strings',
    })

    expect(validateDownloadRequest({ ...validRequest, verifyDownload: 'yes' })).toEqual({
      valid: false,
      error: 'verifyDownload must be a boolean when provided',
    })

    expect(validateDownloadRequest({ ...validRequest, fixture: 'nope' })).toEqual({
      valid: false,
      error: 'fixture must be a boolean when provided',
    })
  })

  it('rejects invalid origin URL', () => {
    const r = { ...validRequest, format: 'epub', origin: 'not-a-url' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
  })

  it('rejects cross-origin referer', () => {
    const r = { ...validRequest, format: 'epub', referer: 'https://evil.com/page' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/referer.*same-origin/)
  })

  it('rejects cross-origin referer with protocol mismatch', () => {
    const r = { ...validRequest, format: 'epub', referer: 'http://1lib.sk/book/123' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/referer.*same-origin/)
  })

  it('accepts empty referer (not provided)', () => {
    const { referer, ...rest } = validRequest
    expect(validateDownloadRequest(rest)).toEqual({ valid: true })
  })

  it('rejects empty outputDir', () => {
    const r = { ...validRequest, format: 'epub', outputDir: '' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/outputDir/)
  })

  it('rejects non-positive timeoutMs', () => {
    const r = { ...validRequest, format: 'epub', timeoutMs: 0 }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timeoutMs/)
  })

  it('rejects negative timeoutMs', () => {
    const r = { ...validRequest, format: 'epub', timeoutMs: -100 }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timeoutMs/)
  })

  it('rejects NaN timeoutMs', () => {
    const r = { ...validRequest, format: 'epub', timeoutMs: Number.NaN }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timeoutMs/)
  })

  it('rejects Infinity timeoutMs', () => {
    const r = { ...validRequest, format: 'epub', timeoutMs: Number.POSITIVE_INFINITY }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timeoutMs/)
  })

  it('rejects unknown transport', () => {
    const r = { ...validRequest, transport: 'unknown-transport' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('electron-cdp-fetch')
  })

  it('rejects non-string transport', () => {
    const r = { ...validRequest, transport: 42 }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(false)
  })

  it('accepts electron-cdp-fetch transport', () => {
    const r = { ...validRequest, transport: 'electron-cdp-fetch' }
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(true)
  })

  it('accepts undefined transport (defaults)', () => {
    const r = { ...validRequest }
    delete r.transport
    const result = validateDownloadRequest(r)
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildDownloadArtifact
// ---------------------------------------------------------------------------

describe('buildDownloadArtifact', () => {
  const request = {
    bookId: '41519811',
    urlRelative: '/dl/aZ6oR1kdj4',
    origin: 'https://1lib.sk',
    outputDir: '/tmp/dl',
    format: 'epub',
  }

  it('returns artifact with correct shape', () => {
    const artifact = buildDownloadArtifact('/tmp/dl/test.epub', request)
    expect(artifact).toHaveProperty('tempPath', '/tmp/dl/test.epub')
    expect(artifact).toHaveProperty('finalPath', '')
    expect(artifact).toHaveProperty('md5', '')
    expect(artifact).toHaveProperty('sizeBytes', 0)
    expect(artifact).toHaveProperty('contentType', '')
    expect(artifact).toHaveProperty('source')
    expect(artifact.source).toHaveProperty('transport', 'electron-cdp-fetch')
    expect(artifact.source).toHaveProperty('finalUrl', '')
    expect(artifact.source).toHaveProperty('cdnMd5', '')
  })

  it('throws on null tempPath', () => {
    expect(() => buildDownloadArtifact(null, request)).toThrow()
  })

  it('throws on relative tempPath', () => {
    expect(() => buildDownloadArtifact('relative/path.epub', request)).toThrow()
  })

  it('throws when tempPath escapes outputDir', () => {
    expect(() => buildDownloadArtifact('/tmp/dl2/file.epub', { ...request, outputDir: '/tmp/dl' })).toThrow()
  })

  it('throws on invalid request', () => {
    expect(() => buildDownloadArtifact('/tmp/dl/test.epub', {
      bookId: '', urlRelative: '/dl/x', origin: 'https://x.com', outputDir: '/tmp',
    })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// createDownloadTraceV2
// ---------------------------------------------------------------------------

describe('createDownloadTraceV2', () => {
  it('produces trace with schemaVersion 2', () => {
    const trace = createDownloadTraceV2({})
    expect(trace.schemaVersion).toBe(2)
    expect(trace.fixtureKind).toBe('zlibrary-app.electron-cdp-download')
  })

  it('includes capturedAt timestamp', () => {
    const trace = createDownloadTraceV2({})
    expect(typeof trace.capturedAt).toBe('string')
    expect(trace.capturedAt.length).toBeGreaterThan(10)
  })

  it('throws on null sources', () => {
    expect(() => createDownloadTraceV2(null)).toThrow('sources must be a plain object')
  })

  it('throws on array sources', () => {
    expect(() => createDownloadTraceV2([])).toThrow('sources must be a plain object')
  })

  it('sanitises /dl/<token> in request chain', () => {
    const trace = createDownloadTraceV2({
      requestChain: [
        {
          url: 'https://1lib.sk/dl/secretToken123',
          status: 302,
          redirectedTo: 'https://cdn.example.com/file.epub',
        },
        {
          url: 'https://cdn.example.com/file.epub',
          status: 200,
          redirectedFrom: 'https://1lib.sk/dl/secretToken123',
        },
      ],
    })
    expect(trace.requestChain[0].url).toContain('/dl/...')
    expect(trace.requestChain[0].url).not.toContain('secretToken123')
    expect(trace.requestChain[1].url).toBe('https://cdn.example.com/file.epub')
    expect(trace.requestChain[0].redirectedTo).toBe('https://cdn.example.com/file.epub')
    expect(trace.requestChain[1].redirectedFrom).toContain('/dl/...')
  })

  it('rejects broken redirect chain parent-child relation', () => {
    expect(() => createDownloadTraceV2({
      requestChain: [
        {
          url: 'https://1lib.sk/dl/secretToken123',
          status: 302,
          redirectedTo: 'https://cdn.example.com/file.epub',
        },
        {
          url: 'https://cdn.example.com/other.epub',
          status: 200,
          redirectedFrom: 'https://1lib.sk/dl/secretToken123',
        },
      ],
    })).toThrow(/redirectedTo must match requestChain\[1\]\.url/)
  })

  it('rejects negative transport counters', () => {
    expect(() => createDownloadTraceV2({
      transport: {
        name: 'electron-cdp-fetch',
        streamBytes: -5,
        chunks: NaN,
      },
    })).toThrow(/non-negative integer/)
  })

  it('accepts valid transport counters', () => {
    const trace = createDownloadTraceV2({
      transport: { streamBytes: 65536, chunks: 5 },
    })
    expect(trace.transport.streamBytes).toBe(65536)
    expect(trace.transport.chunks).toBe(5)
  })

  it('sets error to null when none provided', () => {
    const trace = createDownloadTraceV2({})
    expect(trace.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sanitizeDownloadTraceUrl
// ---------------------------------------------------------------------------

describe('sanitizeDownloadTraceUrl', () => {
  it('redacts /dl/<token> paths', () => {
    const url = 'https://1lib.sk/dl/secretToken123'
    const result = sanitizeDownloadTraceUrl(url)
    expect(result).toBe('https://1lib.sk/dl/...')
  })

  it('preserves non-dl HTTPS URLs', () => {
    const url = 'https://cdn.z-lib.org/file.epub'
    expect(sanitizeDownloadTraceUrl(url)).toBe(url)
  })

  it('rejects http: URLs', () => {
    expect(sanitizeDownloadTraceUrl('http://1lib.sk/dl/token')).toBe('')
  })

  it('rejects javascript: URLs', () => {
    expect(sanitizeDownloadTraceUrl('javascript:alert(1)')).toBe('')
  })

  it('rejects file: URLs', () => {
    expect(sanitizeDownloadTraceUrl('file:///etc/passwd')).toBe('')
  })

  it('rejects data: URLs', () => {
    expect(sanitizeDownloadTraceUrl('data:text/html,hi')).toBe('')
  })

  it('returns empty string for invalid URL', () => {
    expect(sanitizeDownloadTraceUrl('not-a-url')).toBe('')
  })

  it('returns empty string for null', () => {
    expect(sanitizeDownloadTraceUrl(null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// toNonNegativeInteger
// ---------------------------------------------------------------------------

describe('toNonNegativeInteger', () => {
  it('accepts valid non-negative integer', () => {
    expect(toNonNegativeInteger(42)).toBe(42)
    expect(toNonNegativeInteger(0)).toBe(0)
  })

  it('rejects negative values', () => {
    expect(toNonNegativeInteger(-1)).toBe(0)
  })

  it('rejects NaN', () => {
    expect(toNonNegativeInteger(NaN)).toBe(0)
  })

  it('rejects Infinity', () => {
    expect(toNonNegativeInteger(Infinity)).toBe(0)
  })

  it('rejects non-integer', () => {
    expect(toNonNegativeInteger(1.5)).toBe(0)
  })

  it('rejects string', () => {
    expect(toNonNegativeInteger('5')).toBe(0)
  })

  it('uses custom fallback', () => {
    expect(toNonNegativeInteger(-1, 10)).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// extractCdnMd5
// ---------------------------------------------------------------------------

describe('extractCdnMd5', () => {
  it('extracts MD5 from CDN URL with __MD5_<hash>__ pattern', () => {
    const url = 'https://dln1.ncdn.ec/abc123/filename__MD5_9e0d919aad0ea12581a5d189d6ee4e58__.epub'
    expect(extractCdnMd5(url)).toBe('9e0d919aad0ea12581a5d189d6ee4e58')
  })

  it('returns lowercase MD5', () => {
    const url = 'https://cdn.example.com/file__MD5_ABCDEF1234567890ABCDEF1234567890__.pdf'
    expect(extractCdnMd5(url)).toBe('abcdef1234567890abcdef1234567890')
  })

  it('returns empty string for URL without MD5 pattern', () => {
    const url = 'https://dln1.ncdn.ec/abc123/file.epub'
    expect(extractCdnMd5(url)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(extractCdnMd5('')).toBe('')
  })

  it('returns empty string for non-string input', () => {
    expect(extractCdnMd5(null)).toBe('')
    expect(extractCdnMd5(undefined)).toBe('')
    expect(extractCdnMd5(123)).toBe('')
  })
})
