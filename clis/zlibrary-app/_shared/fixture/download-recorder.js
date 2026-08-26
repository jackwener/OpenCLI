/**
 * DownloadFixtureRecorder  -  captures download telemetry for --fixture mode
 *
 * Produces DownloadTraceV2 fixtures (schemaVersion: 2,
 * fixtureKind: 'zlibrary-app.electron-cdp-download').
 *
 * Internal storage mirrors DownloadTraceV2 field layout. At save time,
 * toDownloadTraceV2() calls createDownloadTraceV2() for validation and
 * URL sanitization before writing to disk.
 * @module download-recorder
 */
import path from 'node:path'
import { createDownloadTraceV2, sanitizeDownloadTraceUrl } from '../download/contracts.js'
import { writeJsonAtomic, formatFixtureTimestamp, sanitiseFixtureId } from './output.js'

class DownloadFixtureRecorder {
  constructor({ enabled, command, bookId, outputDir, fixtureDir }) {
    this.enabled = enabled
    this.fixtureDir = fixtureDir || (outputDir ? path.join(outputDir, 'fixtures') : null)
    this.data = {
      schemaVersion: 2,
      fixtureKind: 'zlibrary-app.electron-cdp-download',
      command: command || '',
      capturedAt: new Date().toISOString(),
      book: { bookId: bookId || '', title: '', author: '', extension: '', sourceUrl: '' },
      browserContext: { url: '', origin: '', userAgent: '', language: '' },
      capability: { fetch: { enabled: true, stream: true }, io: { read: true } },
      trigger: { method: 'GET', url: '', headers: {}, cookies: [], secretsRedacted: false },
      requestChain: [],
      transport: { name: 'electron-cdp-fetch', streamBytes: 0, chunks: 0, suppressAction: '', browserDownloadEventSeen: false },
      artifact: { tempPath: '', fileSize: 0, md5: '', contentType: '' },
      validation: { htmlDetected: false, cdnMd5: '', cdnMd5Verified: false, cdnMd5Status: '' },
      error: null,
    }
    this.startTime = Date.now()
  }

  /**
   * Record browser context (url, origin, userAgent, language).
   * language is preserved as extra diagnostic metadata.
   * @param {{ url?: string, origin?: string, userAgent?: string, language?: string }} browserContext
   */
  recordBrowserContext(browserContext) {
    if (!this.enabled) return
    if (browserContext.url !== undefined) this.data.browserContext.url = browserContext.url
    if (browserContext.origin !== undefined) this.data.browserContext.origin = browserContext.origin
    if (browserContext.userAgent !== undefined) this.data.browserContext.userAgent = browserContext.userAgent
    if (browserContext.language !== undefined) this.data.browserContext.language = browserContext.language
  }

  /**
   * Record book metadata (title, author, extension).
   * Populates the 'book' block in DownloadTraceV2.
   * @param {{ bookId?: string, title?: string, author?: string, extension?: string, sourceUrl?: string }} book
   */
  recordBook(book) {
    if (!this.enabled) return
    if (book.bookId !== undefined) this.data.book.bookId = book.bookId
    if (book.title !== undefined) this.data.book.title = book.title
    if (book.author !== undefined) this.data.book.author = book.author
    if (book.extension !== undefined) this.data.book.extension = book.extension
    if (book.sourceUrl !== undefined) this.data.book.sourceUrl = book.sourceUrl
  }

  /**
   * Record HTTP request details (stored in trigger).
   * @param {{ method?: string, url?: string, headers?: object, cookies?: Array<object> }} requestRecord
   */
  recordRequest(requestRecord) {
    if (!this.enabled) return
    this.data.trigger.url = sanitizeDownloadTraceUrl(requestRecord.url || '')
    this.data.trigger.method = requestRecord.method || 'GET'
    if (requestRecord.cookies) {
      this.data.trigger.cookies = requestRecord.cookies.map(c => ({
        name: c.name || '',
        domain: c.domain || '',
        value: c.value || '',
        valueLength: String(c.value || '').length,
        sent: c.sent !== false,
      }))
    }
    if (requestRecord.headers) {
      this.data.trigger.headers = { ...requestRecord.headers }
      for (const headerName of Object.keys(this.data.trigger.headers)) {
        if (headerName.toLowerCase() === 'cookie') {
          this.data.trigger.headers[headerName] = `[REDACTED: ${this.data.trigger.cookies.length} cookies]`
        }
      }
    }
  }

  /**
   * Record HTTP response as a requestChain hop (deprecated path).
   * Prefer recordCdpNetwork for CDP-based downloads.
   * @param {{ url?: string, statusCode?: number, headers?: object, elapsedMs?: number }} responseRecord
   */
  recordResponse(responseRecord) {
    if (!this.enabled) return
    const previousHop = this.data.requestChain[this.data.requestChain.length - 1]
    const hopUrl = responseRecord.url || ''
    if (previousHop && hopUrl) {
      previousHop.redirectedTo = hopUrl
    }
    this.data.requestChain.push({
      url: hopUrl,
      status: responseRecord.statusCode || 0,
      type: 'Navigation',
      timestamp: new Date().toISOString(),
      redirectedFrom: previousHop?.url || '',
    })
  }

  /**
   * Record a CDP network event, converting to requestChain hop or
   * extracting transport trace from stream_done event.
   *
   * Event types handled:
   * - 'stream_done' — extracts transport stream metrics (streamBytes, chunks, suppressAction)
   * - 'dl_paused' / 'redirect_hop' / 'cdn_200' — builds requestChain hop
   *
   * @param {object} entry - CDP event entry
   */
  recordCdpNetwork(entry) {
    if (!this.enabled) return

    // Transport trace: stream_done event carries stream metrics
    if (entry.event === 'stream_done') {
      if (typeof entry.totalBytes === 'number') this.data.transport.streamBytes = entry.totalBytes
      if (typeof entry.chunks === 'number') this.data.transport.chunks = entry.chunks
      if (entry.suppressAction) this.data.transport.suppressAction = entry.suppressAction
      if (entry.md5) this.data.artifact.md5 = entry.md5
      return
    }

    // Skip events without URL info
    const hopUrl = entry.requestUrl || entry.fromUrl || ''
    if (!hopUrl) return

    // Map event type to requestChain hop type
    let hopType = 'Navigation'
    if (entry.event === 'cdn_200') hopType = 'Fetch'
    else if (entry.event === 'redirect_hop') hopType = 'Redirect'

    const previousHop = this.data.requestChain[this.data.requestChain.length - 1]
    const hop = {
      url: hopUrl,
      status: entry.statusCode || 0,
      type: hopType,
      timestamp: new Date(entry.timestamp || Date.now()).toISOString(),
      redirectedFrom: previousHop?.url || '',
    }

    if (previousHop && hopUrl) {
      previousHop.redirectedTo = hopUrl
    }

    this.data.requestChain.push(hop)
  }

  /**
   * Record transport trace data (stream metrics).
   * Alternative to extracting from stream_done CDP event.
   *
   * @param {{ streamBytes?: number, chunks?: number, suppressAction?: string, browserDownloadEventSeen?: boolean }} transportTrace
   */
  recordTransportTrace(transportTrace) {
    if (!this.enabled) return
    if (typeof transportTrace.streamBytes === 'number') this.data.transport.streamBytes = transportTrace.streamBytes
    if (typeof transportTrace.chunks === 'number') this.data.transport.chunks = transportTrace.chunks
    if (transportTrace.suppressAction) this.data.transport.suppressAction = transportTrace.suppressAction
    if (typeof transportTrace.browserDownloadEventSeen === 'boolean') this.data.transport.browserDownloadEventSeen = transportTrace.browserDownloadEventSeen
  }

  /**
   * Record download result data.
   * Maps to artifact and validation blocks per DownloadTraceV2 spec.
   *
   * @param {{ filename?: string, finalPath?: string, fileSizeBytes?: number, md5?: string, cdnMd5?: string, cdnMd5Verified?: boolean, htmlDetected?: boolean }} downloadRecord
   */
  recordDownloadResult(downloadRecord) {
    if (!this.enabled) return
    if (downloadRecord.finalPath) this.data.artifact.tempPath = downloadRecord.finalPath
    if (typeof downloadRecord.fileSizeBytes === 'number') this.data.artifact.fileSize = downloadRecord.fileSizeBytes
    if (downloadRecord.md5) this.data.artifact.md5 = downloadRecord.md5
    if (downloadRecord.filename) this.data.artifact.filename = downloadRecord.filename
    if (downloadRecord.cdnMd5 !== undefined) this.data.validation.cdnMd5 = downloadRecord.cdnMd5
    if (downloadRecord.cdnMd5Verified !== undefined) this.data.validation.cdnMd5Verified = Boolean(downloadRecord.cdnMd5Verified)
    if (downloadRecord.cdnMd5Status !== undefined) this.data.validation.cdnMd5Status = downloadRecord.cdnMd5Status
    if (downloadRecord.htmlDetected !== undefined) this.data.validation.htmlDetected = Boolean(downloadRecord.htmlDetected)
  }

  /**
   * Record error with structured metadata (v2 schema).
   * Captures statusCode and responseHeaders for precise diagnosis.
   * @param {Error} err - Error object
   * @param {string} phase - Execution phase where error occurred
   */
  recordError(err, phase) {
    if (!this.enabled) return
    this.data.error = {
      phase: phase || '',
      type: err?.constructor?.name || typeof err,
      message: err?.message || String(err || ''),
    }
  }

  /**
   * Build a validated DownloadTraceV2 from internal data.
   * Uses createDownloadTraceV2() for URL sanitization and field validation.
   *
   * @returns {object} Validated DownloadTraceV2 record
   * @throws {Error} If internal data fails DownloadTraceV2 validation
   */
  toDownloadTraceV2() {
    const sources = {
      command: this.data.command,
      capturedAt: this.data.capturedAt,
      book: this.data.book,
      browserContext: this.data.browserContext,
      capability: this.data.capability,
      trigger: this.data.trigger,
      requestChain: this.data.requestChain,
      transport: this.data.transport,
      artifact: this.data.artifact,
      validation: this.data.validation,
      error: this.data.error,
    }
    return createDownloadTraceV2(sources)
  }

  /**
   * Save the fixture to disk in DownloadTraceV2 format.
   * Validates via toDownloadTraceV2() before writing.
   *
   * @returns {string|null} Path to saved fixture file, or null if disabled
   */
  save() {
    if (!this.enabled || !this.fixtureDir) return null

    // Build and validate DownloadTraceV2 before writing
    const trace = this.toDownloadTraceV2()

    const filename = buildFixtureFilename(this.data.command, this.data.book.bookId, this.data.capturedAt)
    const filepath = path.join(this.fixtureDir, filename)
    writeJsonAtomic(filepath, trace)
    return filepath
  }
}

function buildFixtureFilename(command, bookId, capturedAt) {
  const safeId = sanitiseFixtureId(bookId)
  return `${command}-${safeId}-${formatFixtureTimestamp(capturedAt)}.fixture.json`
}

export { DownloadFixtureRecorder, buildFixtureFilename }