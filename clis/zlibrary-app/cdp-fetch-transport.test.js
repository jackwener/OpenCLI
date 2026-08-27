// @ts-check

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElectronCdpFetchDownloadTransport } from './_shared/book-download/transport.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const tempFiles = new Set()

/**
 * @returns {object}
 */
function createMinimalEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map()
  return {
    on: (/** @type {string} */ event, /** @type {Function} */ handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(handler)
    },
    off: (/** @type {string} */ event, /** @type {Function} */ handler) => {
      listeners.get(event)?.delete(handler)
    },
    /** Fire event synchronously calling all handlers */
    fire: async (/** @type {string} */ event, /** @type {any} */ data) => {
      const handlers = listeners.get(event)
      if (handlers) {
        for (const h of handlers) await h(data)
      }
    },
  }
}

/**
 * @param {import('vitest').Mock} cdpMock
 */
function makeSimpleCdpMock(cdpMock) {
  let ioReadCallCount = 0
  cdpMock.mockImplementation(async (method, params) => {
    if (method === 'Fetch.enable') return {}
    if (method === 'Fetch.continueRequest') return {}
    if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'mock-stream-handle' }
    if (method === 'Fetch.disable') return {}
    if (method === 'IO.close') return {}
    if (method === 'Fetch.failRequest') return {}

    if (method === 'IO.read') {
      ioReadCallCount++
      if (ioReadCallCount === 1) return { data: Buffer.from('hello world epub data').toString('base64'), base64Encoded: true, eof: false }
      return { eof: true }
    }
    return {}
  })
}

/**
 * @param {object} page
 * @param {object} eventBus
 * @param {import('vitest').Mock} cdpMock
 * @param {string[]} [requestPausedEvents]
 */
async function runDownloadWithEvents(cdpMock, page, eventBus, requestPausedEvents = []) {
  makeSimpleCdpMock(cdpMock)

  const transport = new ElectronCdpFetchDownloadTransport(page, eventBus, { timeoutMs: 5000 })

  const tmpFile = `/tmp/opencli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.epub`
  tempFiles.add(tmpFile)

  const dlPromise = transport.download({
    bookId: 'test-1',
    urlRelative: '/dl/token123',
    origin: 'https://1lib.sk',
    referer: 'https://1lib.sk/book/xyz',
    format: 'epub',
    outputDir: '/tmp',
    timeoutMs: 5000,
  }, { tempPath: tmpFile })

  // Yield once so the transport sets up Fetch and waits for events
  await new Promise(process.nextTick)

  for (const evt of requestPausedEvents) {
    await eventBus.fire('Fetch.requestPaused', JSON.parse(evt))
    await new Promise(process.nextTick)
  }

  return await dlPromise
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ElectronCdpFetchDownloadTransport', () => {
  afterEach(() => {
    const fs = require('node:fs')
    for (const f of tempFiles) {
      try { fs.unlinkSync(f) } catch {}
    }
    tempFiles.clear()
  })

  describe('request validation', () => {
    it('rejects empty bookId', async () => {
      const page = { cdp: vi.fn(), evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()
      const t = new ElectronCdpFetchDownloadTransport(page, bus)

      await expect(t.download({
        bookId: '', urlRelative: '/dl/x', origin: 'https://x.com',
        referer: 'https://x.com/p', format: 'epub', outputDir: '/tmp',
      })).rejects.toThrow('Invalid download request')
    })

    it('rejects non-/dl/ urlRelative', async () => {
      const page = { cdp: vi.fn(), evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()
      const t = new ElectronCdpFetchDownloadTransport(page, bus)

      await expect(t.download({
        bookId: '1', urlRelative: '/book/xyz', origin: 'https://x.com',
        referer: 'https://x.com/p', format: 'epub', outputDir: '/tmp',
      })).rejects.toThrow('Invalid download request')
    })

    it('rejects cross-origin referer', async () => {
      const page = { cdp: vi.fn(), evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()
      const t = new ElectronCdpFetchDownloadTransport(page, bus)

      await expect(t.download({
        bookId: '1', urlRelative: '/dl/x', origin: 'https://x.com',
        referer: 'https://evil.com/p', format: 'epub', outputDir: '/tmp',
      })).rejects.toThrow('Invalid download request')
    })
  })

  describe('Fetch.enable failure', () => {
    it('throws when Fetch domain not available', async () => {
      const cdp = vi.fn().mockRejectedValue(new Error('No Fetch'))
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()
      const t = new ElectronCdpFetchDownloadTransport(page, bus)

      await expect(t.download({
        bookId: '1', urlRelative: '/dl/x', origin: 'https://x.com',
        referer: 'https://x.com/p', format: 'epub', outputDir: '/tmp',
      })).rejects.toThrow('Fetch domain not available')
    })
  })

  describe('timeout', () => {
    it('times out when no Fetch events fire', async () => {
      const cdp = vi.fn()
      cdp.mockImplementation(async (method) => {
        if (method === 'Fetch.enable') return {}
        if (method === 'Fetch.disable') return {}
        return {}
      })
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()
      const t = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 100 })

      await expect(t.download({
        bookId: '1', urlRelative: '/dl/x', origin: 'https://x.com',
        referer: 'https://x.com/p', format: 'epub', outputDir: '/tmp',
      })).rejects.toThrow('Timed out waiting')
    })
  })

  describe('redirect chain', () => {
    it('handles /dl/* 302 → CDN 200, streams bytes', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      const cdnUrl = 'https://cdn.z-lib.org/dl/file.epub?filename=Title(Author)__MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6__.epub'

      makeSimpleCdpMock(cdp)

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.epub`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-redirect',
        urlRelative: '/dl/token456',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/abc',
        format: 'epub',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      // /dl/* 302
      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-1',
        responseStatusCode: 302,
        request: { url: 'https://1lib.sk/dl/token456' },
      })
      await new Promise(process.nextTick)

      // CDN 200
      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-cdn-1',
        responseStatusCode: 200,
        redirectedRequestId: 'req-dl-1',
        request: { url: cdnUrl },
      })

      const result = await dlPromise

      expect(result.sizeBytes).toBeGreaterThan(0)
      expect(result.md5).toBeTruthy()
      expect(result.source.finalUrl).toBe(cdnUrl)
      expect(result.source.cdnMd5).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
      expect(result.source.transport).toBe('electron-cdp-fetch')

      // File written to disk
      const fs = require('node:fs')
      expect(fs.existsSync(tmpFile)).toBe(true)
      const stat = fs.statSync(tmpFile)
      expect(stat.size).toBeGreaterThan(0)
    })

    it('keeps tracking across multiple redirect hops', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      makeSimpleCdpMock(cdp)

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.epub`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-multihop',
        urlRelative: '/dl/token-multi',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/multi',
        format: 'epub',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-1',
        responseStatusCode: 302,
        request: { url: 'https://1lib.sk/dl/token-multi' },
      })
      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-2',
        responseStatusCode: 302,
        redirectedRequestId: 'req-dl-1',
        request: { url: 'https://redir.example.com/hop-2' },
      })
      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-cdn-1',
        responseStatusCode: 200,
        redirectedRequestId: 'req-dl-2',
        request: { url: 'https://cdn.example.com/final-multi.epub' },
      })

      const result = await dlPromise

      expect(result.source.finalUrl).toBe('https://cdn.example.com/final-multi.epub')
      expect(cdp).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'req-dl-2' })
      expect(result.sizeBytes).toBeGreaterThan(0)
    })

    it('handles direct 200 without redirect', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      makeSimpleCdpMock(cdp)

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.pdf`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-direct',
        urlRelative: '/dl/xyz',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/def',
        format: 'pdf',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      // Direct 200 (no redirect)
      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-direct-1',
        responseStatusCode: 200,
        request: { url: 'https://1lib.sk/dl/xyz' },
      })

      const result = await dlPromise

      expect(result.sizeBytes).toBeGreaterThan(0)
      expect(result.source.finalUrl).toBe('https://1lib.sk/dl/xyz')
      expect(result.source.cdnMd5).toBe('')
    })
  })

  describe('stream and suppress', () => {
    it('calls takeResponseBodyAsStream and IO.read', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      makeSimpleCdpMock(cdp)

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.epub`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-stream',
        urlRelative: '/dl/token789',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/ghi',
        format: 'epub',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-1',
        responseStatusCode: 302,
        request: { url: 'https://1lib.sk/dl/token789' },
      })
      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-cdn-1',
        responseStatusCode: 200,
        redirectedRequestId: 'req-dl-1',
        request: { url: 'https://cdn.example.com/final.epub' },
      })

      const result = await dlPromise

      // Verify CDP calls
      expect(cdp).toHaveBeenCalledWith('Fetch.takeResponseBodyAsStream', { requestId: 'req-cdn-1' })
      expect(cdp).toHaveBeenCalledWith('Fetch.failRequest', { requestId: 'req-cdn-1', errorReason: 'Aborted' })

      const ioReadCalls = cdp.mock.calls.filter(c => c[0] === 'IO.read')
      expect(ioReadCalls.length).toBeGreaterThan(0)

      expect(result.sizeBytes).toBeGreaterThan(0)
    })

    it('cleans up IO handle and Fetch on success', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      makeSimpleCdpMock(cdp)

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.epub`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-cleanup',
        urlRelative: '/dl/token101',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/jkl',
        format: 'epub',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-1',
        responseStatusCode: 200,
        request: { url: 'https://1lib.sk/dl/token101' },
      })

      await dlPromise

      expect(cdp).toHaveBeenCalledWith('IO.close', { handle: 'mock-stream-handle' })
      expect(cdp).toHaveBeenCalledWith('Fetch.disable')
    })



    it('survives Fetch.failRequest error gracefully', async () => {
      const cdp = vi.fn()
      const page = { cdp, evaluate: vi.fn(), goto: vi.fn() }
      const bus = createMinimalEventBus()

      // Build a single mock that throws on Fetch.failRequest but delegates
      // to the simple mock for all other methods — no fresh mock per call.
      makeSimpleCdpMock(cdp)
      // Wrap after makeSimpleCdpMock so failRequest throw wins
      const origImpl = cdp.getMockImplementation()
      cdp.mockImplementation(async (method, params) => {
        if (method === 'Fetch.failRequest') throw new Error('Already suppressed')
        // Delegate to original simple mock for all other methods
        return origImpl(method, params)
      })

      const transport = new ElectronCdpFetchDownloadTransport(page, bus, { timeoutMs: 2000 })
      const tmpFile = `/tmp/opencli-test-${Date.now()}.epub`
      tempFiles.add(tmpFile)

      const dlPromise = transport.download({
        bookId: 'test-suppress-fail',
        urlRelative: '/dl/token202',
        origin: 'https://1lib.sk',
        referer: 'https://1lib.sk/book/mno',
        format: 'epub',
        outputDir: '/tmp',
        timeoutMs: 2000,
      }, { tempPath: tmpFile })

      await new Promise(process.nextTick)

      await bus.fire('Fetch.requestPaused', {
        requestId: 'req-dl-1',
        responseStatusCode: 200,
        request: { url: 'https://1lib.sk/dl/token202' },
      })

      const result = await dlPromise
      expect(result).toBeDefined()
    })
  })
})
