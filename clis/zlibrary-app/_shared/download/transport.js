// @ts-check

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { validateDownloadRequest, buildDownloadArtifact, extractCdnMd5 } from './contracts.js'
import { sanitizeDownloadTraceUrl } from '../infra/url-boundary.js'
import { buildDesktopAppHeaders } from '../infra/desktop-app-headers.js'

/**
 * Transport function signature for `downloadWithElectronCdpFetch`.
 *
 * @typedef {Object} DownloadContext
 * @property {import('../../../../src/types.js').IPage} page
 * @property {import('./contracts.js').EventBus} eventBus
 * @property {number} [timeoutMs=120000]
 * @property {string} [tempPath] - override temp path
 * @property {(event: object) => void} [onCdpEvent] - callback for CDP phase events (for fixture recording)
 *
 * @typedef {import('./contracts.js').DownloadRequest} DownloadRequest
 * @typedef {import('./contracts.js').DownloadArtifact} DownloadArtifact
 * @typedef {import('./workflow.js').DownloadWorkflowResult} DownloadWorkflowResult
 */

/**
 * CDP Fetch stream download transport for Electron webviews.
 *
 * Uses CDP Fetch domain to intercept the /dl/* → CDN redirect chain at the
 * Response stage, stream the final CDN response body via IO.read, then
 * suppress the browser's native download pipeline.
 *
 * CDP Fetch creates a NEW requestId per redirect hop, linked by the
 * redirectedRequestId field. The initial /dl/ request fires requestPaused,
 * and after 302 the CDN redirect fires with a new requestId. Since the CDN
 * URL is cross-origin (dln1.ncdn.ec), a scoped pattern'${origin}/dl/*'
 * would NOT capture the CDN 200 — urlPattern: '*' is required.
 * Security is via handler tracking (/dl/ origin match + redirect chain),
 * not by URL pattern. See spec opencli-framework-cdp.md > Gotcha: CDP
 * redirect creates new requestId per hop.
 *
 * Proven by live probe (06-22-eval-live-probe): 1.7MB EPUB captured without
 * save dialog on Z-Library Desktop Electron webview.
 */
export class ElectronCdpFetchDownloadTransport {
  /**
   * @param {import('../../../../src/types.js').IPage} page  -  CDP page instance
   * @param {import('./contracts.js').EventBus} eventBus
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=120000]
   */
  constructor(page, eventBus, opts = {}) {
    /** @type {import('../../../../src/types.js').IPage} */
    this._page = page
    /** @type {import('./contracts.js').EventBus} */
    this._eventBus = eventBus
    /** @type {number} */
    this._timeoutMs = opts.timeoutMs ?? 120000
    /** @type {string|null} */
    this._dlRequestId = null
  }

  /**
   * Download a file via CDP Fetch stream hijack.
   *
   * @param {import('./contracts.js').DownloadRequest} request
   * @param {object} [opts]
   * @param {string} [opts.tempPath] override temp path
   * @returns {Promise<import('./contracts.js').DownloadArtifact>}
   * @throws {Error} on validation, Fetch unavailable, timeout, stream failure
   */
  async download(request, opts = {}) {
    return downloadWithElectronCdpFetch(request, {
      page: this._page,
      eventBus: this._eventBus,
      timeoutMs: this._timeoutMs,
      tempPath: opts.tempPath,
    })
  }
}

// ---------------------------------------------------------------------------
// detectMimeFromBytes (module-private)
// ---------------------------------------------------------------------------

/**
 * Detect MIME type from file magic bytes.
 *
 * @param {string} filePath
 * @returns {string}  -  MIME type or empty string if unknown
 */
function detectMimeFromBytes(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(68)
    const bytesRead = fs.readSync(fd, buf, 0, 68, 0)
    fs.closeSync(fd)
    const header = buf.subarray(0, bytesRead)

    // PDF: %PDF-
    if (header.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf'

    // ZIP-based: EPUB or plain ZIP
    if (header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04) {
      const fullBuf = buf.toString('latin1', 0, Math.min(bytesRead, 68))
      if (fullBuf.includes('application/epub+zip')) return 'application/epub+zip'
      return 'application/zip'
    }

    // MOBI/AZW: BOOKMOBI prefix
    if (header.slice(0, 8).toString('latin1').includes('BOOKMOBI')) {
      return 'application/x-mobipocket-ebook'
    }

    return ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// initCdpDownload  -  reusable CDP download wrapper
//
// Single entry point for CDP Fetch download used by both download.js and
// booklist-download.js. Wires event bus (page.bridge), creates the transport
// function, runs the full workflow (validate → transport → ingest → rename),
// and returns DownloadWorkflowResult.
//
// Usage:
//   const result = await initCdpDownload(page, request, { onCdpEvent })
// ---------------------------------------------------------------------------

/**
 * Execute a CDP Fetch download with full workflow.
 *
 * @param {import('../../../../src/types.js').IPage} page - CDP page target
 * @param {DownloadRequest} request - download request object
 * @param {object} [opts]
 * @param {(event: object) => void} [opts.onCdpEvent] - CDP event callback (fixture recording)
 * @param {boolean} [opts.verifyDownload] - verify against request.metadata.md5
 * @returns {Promise<DownloadWorkflowResult>}
 * @throws {CommandExecutionError} if page.bridge unavailable
 */
export async function initCdpDownload(page, request, opts = {}) {
  const bridge = /** @type {any} */ (page).bridge
  if (!bridge || typeof bridge.on !== 'function' || typeof bridge.off !== 'function') {
    const { CommandExecutionError } = await import('@jackwener/opencli/errors')
    throw new CommandExecutionError('CDP event bus unavailable — page must be direct CDP target')
  }
  const eventBus = { on: (e, h) => bridge.on(e, h), off: (e, h) => bridge.off(e, h) }
  const { runDownloadWorkflow } = await import('./workflow.js')
  const transportFn = (req, ctx) => downloadWithElectronCdpFetch(req, { ...ctx, page, eventBus, onCdpEvent: opts.onCdpEvent })
  return runDownloadWorkflow(transportFn, request, { verifyDownload: opts.verifyDownload })
}

// ---------------------------------------------------------------------------
// downloadWithElectronCdpFetch  -  standalone transport function
// ---------------------------------------------------------------------------

/**
 * Download a file via CDP Fetch stream hijack (standalone function).
 *
 * Steps:
 *   1. Validate request + temp path containment
 *   2. Register Fetch.requestPaused listener
 *   3. Fetch.enable with `*` (Response) + `${origin}/dl/*` (Request) patterns
 *   4. Trigger /dl/* download via hidden anchor click
 *   5. Track redirect chain (302 -> CDN 200)
 *   6. takeResponseBodyAsStream + IO.read loop (incremental file write + MD5)
 *   7. FailRequest to suppress browser native download
 *   8. Return DownloadArtifact with MIME sniff
 *
 * @param {DownloadRequest} request
 * @param {DownloadContext} context
 * @returns {Promise<DownloadArtifact>}
 * @throws {Error} on validation, Fetch unavailable, timeout, stream failure
 */
export async function downloadWithElectronCdpFetch(request, context) {
  const { page, eventBus, timeoutMs = 120000, tempPath: overrideTempPath, onCdpEvent } = context

  // Step 1: Validate request
  const validation = validateDownloadRequest(request)
  if (!validation.valid) {
    throw new Error(`Invalid download request: ${/** @type {any} */ (validation).error}`)
  }

  const { urlRelative, outputDir, bookId, format } = request
  const tempPath = overrideTempPath || path.resolve(outputDir, `${bookId}.tmp.${format}`)

  // Validate temp path containment (must not escape outputDir)
  const resolvedDir = path.resolve(outputDir)
  const resolvedTemp = path.resolve(tempPath)
  if (!resolvedTemp.startsWith(resolvedDir + path.sep) && resolvedTemp !== resolvedDir) {
    throw new Error(`Temp path escapes outputDir: ${tempPath}`)
  }

  // Step 2: Set up Fetch.requestPaused listener
  /** @type {Array<{fromRequestId:string, toRequestId:string|null, url:string, statusCode:number}>} */
  const redirectChain = []
  /** @type {Set<string>} */
  const trackedRequestIds = new Set()
  let /** @type {string|null} */ streamRequestId = null
  let /** @type {string} */ finalCdnUrl = ''
  let /** @type {string|null} */ ioHandle = null
  /** @type {((value:void) => void)|null} */
  let fetchPromiseResolve = null
  /** @type {((reason:Error) => void)|null} */
  let fetchPromiseReject = null
  const fetchPromise = new Promise(/** @type {(resolve: (value: void) => void, reject: (reason: Error) => void) => void} */ ((resolve, reject) => {
    fetchPromiseResolve = resolve
    fetchPromiseReject = reject
  }))
  let /** @type {string|null} */ dlRequestId = null

  const onRequestPaused = async (/** @type {any} */ paused) => {
    if (!paused || !paused.requestId) return
    // Detect Request vs Response: Desktop App bridge may omit requestStage.
    // Request-stage events have no response fields.
    const hasResponse = typeof paused.responseStatusCode === 'number' ||
      Array.isArray(paused.responseHeaders) ||
      typeof paused.responseErrorReason === 'string'
    // Skip Request-stage events — handled by onRequestStage header injector
    if (!hasResponse) return
    const requestId = /** @type {string} */ (paused.requestId)
    const statusCode = typeof paused.responseStatusCode === 'number' ? paused.responseStatusCode : 0
    const redirectedId = typeof paused.redirectedRequestId === 'string' ? paused.redirectedRequestId : null
    const requestUrl = paused.request && typeof paused.request.url === 'string' ? paused.request.url : ''

    // Track the first /dl/* request by URL pattern with same-origin check.
    // The real security gate is new URL().pathname.startsWith('/dl/') + origin
    // validation below — no pre-gate needed (unanchored substring on untrusted
    // CDP event payload is unreliable). See spec opencli-framework-cdp.md.
    if (!dlRequestId) {
      try {
        const parsed = new URL(requestUrl)
        if (parsed.origin === request.origin && parsed.pathname.startsWith('/dl/')) {
          dlRequestId = requestId
          trackedRequestIds.add(requestId)
          if (onCdpEvent) {
            onCdpEvent({
              event: 'dl_paused',
              requestUrl: sanitizeDownloadTraceUrl(requestUrl),
              requestMethod: paused.request && typeof paused.request.method === 'string' ? paused.request.method : 'GET',
              statusCode,
              requestId,
              timestamp: Date.now(),
            })
          }
        }
      } catch { /* ignore unparseable URLs */ }
    }

    // Determine if this request is part of our tracked download chain
    const isTracked = trackedRequestIds.has(requestId) ||
      (redirectedId !== null && trackedRequestIds.has(redirectedId)) ||
      requestId === streamRequestId

    if (!isTracked) {
      try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* pass through unrelated */ }
      return
    }

    // Redirect hop (3xx)
    if (statusCode >= 300 && statusCode < 400) {
      redirectChain.push({ fromRequestId: requestId, toRequestId: redirectedId, url: requestUrl, statusCode })
      trackedRequestIds.add(requestId)
      if (onCdpEvent) {
        onCdpEvent({
          event: 'redirect_hop',
          fromUrl: sanitizeDownloadTraceUrl(requestUrl),
          statusCode,
          requestId,
          timestamp: Date.now(),
        })
      }
      try {
        await page.cdp('Fetch.continueRequest', { requestId })
      } catch {
        if (fetchPromiseReject) fetchPromiseReject(new Error('Fetch.continueRequest failed for redirect'))
      }
      return
    }

    // Final CDN response (200)  -  save URL, resolve promise to begin streaming
    if (statusCode === 200) {
      streamRequestId = requestId
      finalCdnUrl = requestUrl
      trackedRequestIds.add(requestId)
      if (onCdpEvent) {
        const contentType = paused.responseHeaders && typeof paused.responseHeaders === 'object' && 'content-type' in paused.responseHeaders
          ? String(paused.responseHeaders['content-type'])
          : (paused.responseHeaders && typeof paused.responseHeaders === 'object' && 'Content-Type' in paused.responseHeaders
            ? String(paused.responseHeaders['Content-Type'])
            : '')
        const contentLength = paused.responseHeaders && typeof paused.responseHeaders === 'object' && 'content-length' in paused.responseHeaders
          ? String(paused.responseHeaders['content-length'])
          : (paused.responseHeaders && typeof paused.responseHeaders === 'object' && 'Content-Length' in paused.responseHeaders
            ? String(paused.responseHeaders['Content-Length'])
            : '')
        onCdpEvent({
          event: 'cdn_200',
          requestUrl: sanitizeDownloadTraceUrl(requestUrl),
          statusCode,
          contentType,
          contentLength,
          timestamp: Date.now(),
        })
      }
      if (fetchPromiseResolve) fetchPromiseResolve()
      return
    }

    // Unexpected status
    try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* pass */ }
    if (fetchPromiseReject) fetchPromiseReject(new Error('Unexpected response status: ' + statusCode))
  }

  // Request-stage handler: inject desktop-app headers into /dl/* requests
  // before the browser forwards them to the CDN. Without these headers,
  // Z-Library CDN returns stub files instead of real EPUBs.
  const onRequestStage = async (/** @type {any} */ paused) => {
    if (!paused || !paused.requestId) return
    // Only handle Request stage events (bridge may omit requestStage field)
    const hasResponse = typeof paused.responseStatusCode === 'number' ||
      Array.isArray(paused.responseHeaders) ||
      typeof paused.responseErrorReason === 'string'
    if (hasResponse) return
    const requestUrl = paused.request && typeof paused.request.url === 'string' ? paused.request.url : ''
    try {
      const parsed = new URL(requestUrl)
      if (parsed.origin === request.origin && parsed.pathname.startsWith('/dl/')) {
        // Inject desktop-app headers while preserving original headers.
        // CAUTION: Fetch.continueRequest with `headers` OVERRIDES all original
        // headers — including Cookie, User-Agent, Accept, etc. We must merge.
        const originalHeaders = typeof paused.request?.headers === 'object' && paused.request.headers !== null
          ? paused.request.headers : []
        const originalEntries = Array.isArray(originalHeaders) ? originalHeaders
          : Object.entries(originalHeaders).map(([k, v]) => ({ name: k, value: String(v) }))

        const extraHeaders = buildDesktopAppHeaders()
        const extraEntries = Object.entries(extraHeaders).map(([name, value]) => ({
          name,
          value: String(value),
        }))

        // Build lookup of extra header names (lowercase) for dedup
        const extraNames = new Set(extraEntries.map(h => h.name.toLowerCase()))
        const mergedHeaders = [
          ...originalEntries.filter(h => !extraNames.has(h.name.toLowerCase())),
          ...extraEntries,
        ]

        try {
          await page.cdp('Fetch.continueRequest', {
            requestId: paused.requestId,
            headers: mergedHeaders,
          })
        } catch (continueErr) {
          throw new Error('Failed to inject desktop-app headers into /dl/* request: ' + (continueErr.message || continueErr))
        }
        return
      }
    } catch { /* ignore unparseable URLs */ }
    // Non-/dl/* requests pass through unchanged
    try { await page.cdp('Fetch.continueRequest', { requestId: paused.requestId }) } catch {}
  }

  eventBus.on('Fetch.requestPaused', onRequestStage)
  eventBus.on('Fetch.requestPaused', onRequestPaused)

  try {
    // Step 3: Enable Fetch at Response stage with broad pattern.
    // Must use urlPattern: '*' because CDN redirects go cross-origin.
    // Tracking via requestId chain ensures only /dl/-descendant responses are processed.
    try {
      await page.cdp('Fetch.enable', {
        patterns: [
          { urlPattern: '*', requestStage: 'Response' },
          // Request-stage pattern for /dl/*: injects desktop-app headers
          // before the CDN sees the request.
          { urlPattern: `${request.origin}/dl/*`, requestStage: 'Request' },
        ],
      })
      if (onCdpEvent) onCdpEvent({
        event: 'fetch_enable',
        scope: '*',
        requestStage: 'Response',
        origin: request.origin,
        timestamp: Date.now(),
      })
    } catch {
      throw new Error('Fetch domain not available on this target')
    }

    // Step 4: Trigger download via programmatic click
    try {
      await page.evaluate((/** @type {string} */ urlRelative) => {
        const a = document.createElement('a')
        a.href = urlRelative
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }, urlRelative)
    } catch { /* navigation aborted by Fetch  -  expected */ }

    // Step 5: Wait for final CDN 200 response (or timeout)
    await Promise.race([
      fetchPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for CDN 200 response')), timeoutMs)
      ),
    ])

    if (!streamRequestId) {
      throw new Error('No final CDN response received')
    }

    // Step 6: Take response body as stream and write incrementally to file
    const streamResult = /** @type {any} */ (await page.cdp('Fetch.takeResponseBodyAsStream', {
      requestId: streamRequestId,
    }))
    ioHandle = /** @type {string} */ (streamResult.stream || streamResult.handle || '')
    if (!ioHandle) throw new Error('Failed to get stream handle')

    // Ensure temp dir exists
    const dir = path.dirname(tempPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    // Incremental file write + incremental MD5 (no Buffer.concat)
    const writeFd = fs.openSync(tempPath, 'w')
    const md5Hasher = crypto.createHash('md5')
    let totalBytes = 0
    let iterations = 0
    const maxIterations = 10000

    try {
      while (true) {
        const chunk = /** @type {any} */ (await page.cdp('IO.read', { handle: ioHandle, size: 65536 }))
        if (chunk && chunk.data) {
          const buf = chunk.base64Encoded
            ? Buffer.from(chunk.data, 'base64')
            : Buffer.from(chunk.data, 'utf-8')
          // Incremental write
          fs.writeSync(writeFd, buf)
          // Incremental MD5 update
          md5Hasher.update(buf)
          totalBytes += buf.length
        }
        if (chunk && chunk.eof) break
        iterations++
        if (iterations >= maxIterations) {
          throw new Error('IO.read exceeded maximum iterations (' + maxIterations + ')')
        }
      }
    } finally {
      fs.closeSync(writeFd)
    }

    // Suppress browser native download AFTER streaming is complete.
    // CAUTION: failRequest aborts the connection. If called before streaming
    // completes, the response body is truncated to whatever was buffered.
    try {
      await page.cdp('Fetch.failRequest', {
        requestId: streamRequestId,
        errorReason: 'Aborted',
      })
    } catch { /* suppress may fail if request already completed */ }

    const md5 = md5Hasher.digest('hex')

    if (onCdpEvent) {
      onCdpEvent({
        event: 'stream_done',
        tempPath,
        totalBytes,
        chunks: iterations,
        md5,
        suppressAction: 'Aborted',
        timestamp: Date.now(),
      })
    }

    // Step 8: Build artifact with MIME sniff
    const finalUrl = finalCdnUrl || (redirectChain.length > 0
      ? redirectChain[redirectChain.length - 1].url
      : '')

    const artifact = buildDownloadArtifact(tempPath, request)
    artifact.sizeBytes = totalBytes
    artifact.md5 = md5
    artifact.source.finalUrl = finalUrl
    artifact.source.cdnMd5 = extractCdnMd5(finalUrl)

    // MIME sniff from magic bytes
    artifact.contentType = detectMimeFromBytes(tempPath)

    return artifact
  } finally {
    // Cleanup: IO handle, Fetch domain, event listener
    if (ioHandle) {
      try { await page.cdp('IO.close', { handle: ioHandle }) } catch { /* best-effort */ }
    }
    try { await page.cdp('Fetch.disable') } catch { /* best-effort */ }
    eventBus.off('Fetch.requestPaused', onRequestStage)
    eventBus.off('Fetch.requestPaused', onRequestPaused)
  }
}
