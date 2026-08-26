#!/usr/bin/env node

/**
 * CDP Download Live Probe — desktop-app header injection test.
 *
 * DEVELOPMENT USE ONLY. Connects to Z-Library Desktop via CDP, navigates
 * to a book page, extracts /dl/<token>, sets up CDP Fetch with Request-stage
 * interception, injects desktop-app-* headers, streams response to temp file,
 * and reports whether real EPUB (>100KB) or stub (<4KB).
 *
 * Usage:
 *   node clis/zlibrary-app/scripts/probe-cdp-download.mjs --url <book-url>
 *
 * Prerequisites:
 *   - Z-Library Desktop running, logged in, on a Z-Library site
 *   - OPENCLI_CDP_ENDPOINT env var (default: http://127.0.0.1:9222/json)
 *   - --url must be a Z-Library HTTPS book detail page
 *
 * Flags:
 *   --url <bookUrl>   Z-Library book detail URL (REQUIRED)
 *   --json            Machine-readable JSON output to stdout
 */

import { CDPBridge } from '@jackwener/opencli/browser/cdp'
import { buildDesktopAppHeaders } from '../_shared/desktop-app-headers.js'

import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STUB_THRESHOLD = 4096        // bytes — less than this is a stub
const REAL_BOOK_MIN = 102400       // bytes — 100KB minimum for real EPUB
const PROBE_TIMEOUT = 120000       // ms overall timeout
const IO_READ_CHUNK = 65536        // bytes per IO.read call
const MAX_IO_ITERATIONS = 10000
const PROBE_RESULTS_DIR = '/tmp/probe-results'

// Allowed Z-Library origins (same as live-probe-runner.js)
const ALLOWED_ZLIBRARY_ORIGINS = [
  'z-lib.org',
  'z-lib.sk',
  'z-lib.fm',
  'z-library.im',
  '1lib.sk',
  '1lib.world',
  'frenchbooks.sk',
  'itbooks.sk',
  'krbooks.sk',
  'ptbooks.sk',
  'esbooks.sk',
  'zhbooks.sk',
  'arbooks.sk',
  'arabooks.sk',
  'trbooks.sk',
  'nlbooks.sk',
  'plbooks.sk',
  'cnbooks.sk',
  'jpbooks.sk',
  'books.sk',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let jsonMode = false

function out(text) {
  if (!jsonMode) process.stdout.write(text + '\n')
}

function err(text) {
  process.stderr.write(text + '\n')
}

function color(status, text) {
  if (status === 'pass') return `\x1b[32m${text}\x1b[0m`
  if (status === 'fail') return `\x1b[31m${text}\x1b[0m`
  if (status === 'warn') return `\x1b[33m${text}\x1b[0m`
  return text
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isValidZlibOrigin(rawOrigin) {
  try {
    const u = new URL(rawOrigin)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const hostname = u.hostname.toLowerCase()
    for (const allowed of ALLOWED_ZLIBRARY_ORIGINS) {
      if (hostname === allowed || hostname.endsWith('.' + allowed)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Sanitize a download URL for trace logging by redacting /dl/<token>.
 * Simplified inline version to avoid extra imports.
 */
function sanitizeDlUrl(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return ''
    const redacted = parsed.pathname.replace(/\/dl\/[^/]+/, '/dl/...')
    return parsed.origin + redacted + parsed.search + parsed.hash
  } catch {
    return ''
  }
}

/**
 * Detect file type from magic bytes.
 */
function detectFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(68)
    const bytesRead = fs.readSync(fd, buf, 0, 68, 0)
    fs.closeSync(fd)
    const header = buf.subarray(0, bytesRead)

    // PDF: %PDF-
    if (header.slice(0, 4).toString('ascii') === '%PDF') return 'PDF'

    // ZIP-based: EPUB or plain ZIP
    if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04) {
      const fullBuf = buf.toString('latin1', 0, Math.min(bytesRead, 68))
      if (fullBuf.includes('application/epub+zip')) return 'EPUB'
      return 'ZIP'
    }

    // MOBI/AZW
    if (header.slice(0, 8).toString('latin1').includes('BOOKMOBI')) return 'MOBI'

    // HTML block page
    if (header.slice(0, 1).toString('ascii') === '<') {
      const headSample = header.slice(0, 40).toString('ascii')
      if (headSample.startsWith('<')) return 'HTML (likely block page)'
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runProbe() {
  const args = process.argv.slice(2)

  if (args.includes('--json')) jsonMode = true

  const urlFlag = args.find((a, i) => a === '--url' && args[i + 1])
  const targetUrl = urlFlag ? args[args.indexOf('--url') + 1] : null

  if (!targetUrl) {
    err('ERROR: --url is required. Provide a Z-Library book detail page URL.')
    process.exit(1)
  }

  if (!isValidZlibOrigin(targetUrl)) {
    err('ERROR: --url must be a Z-Library HTTPS site (allowed origins: z-lib.org, 1lib.sk, etc.)')
    process.exit(1)
  }

  if (args.includes('--help') || args.includes('-h')) {
    out('Usage: node probe-cdp-download.mjs --url <book-url> [--json]')
    out('')
    out('  --url <bookUrl>   Z-Library book detail URL (REQUIRED)')
    out('  --json            Machine-readable JSON output to stdout')
    process.exit(0)
  }

  // -----------------------------------------------------------------------
  // Phase 0: Connect to CDP
  // -----------------------------------------------------------------------

  out('')
  out('=== CDP Download Probe ===')
  out(`Book: ${targetUrl}`)

  let bridge = null
  let page = null
  let cleanFetchDone = false

  async function cleanup() {
    if (cleanFetchDone) return
    cleanFetchDone = true
    try {
      if (bridge && typeof bridge.send === 'function') {
        await bridge.send('Fetch.disable', {}).catch(() => {})
      }
    } catch {}
    try {
      if (bridge && typeof bridge.close === 'function') {
        await bridge.close().catch(() => {})
      }
    } catch {}
    process.exit(130)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  err('[cdp] Connecting to Z-Library Desktop via CDP...')
  try {
    bridge = new CDPBridge()
    page = await bridge.connect({
      timeout: 15,
      surface: 'adapter',
      windowMode: 'foreground',
      preferHttpsTargets: true,
    })
    err(`[cdp] Connected, session: ${page.session}`)
  } catch (err_) {
    err(`[cdp] FAILED: ${err_.message}`)
    out(`Status: ${color('fail', '❌ FAIL')}`)
    out('Detail:')
    out('  Could not connect to Z-Library Desktop via CDP.')
    out('  Is Z-Library Desktop running with remote debugging enabled?')
    out(`  OPENCLI_CDP_ENDPOINT=${process.env.OPENCLI_CDP_ENDPOINT || '(default localhost:9222)'}`)
    process.exit(1)
  }

  // -----------------------------------------------------------------------
  // Phase 1: Verify origin and navigate to book page
  // -----------------------------------------------------------------------

  try {
    const preNavOrigin = await page.evaluate('window.location.origin')
    if (!isValidZlibOrigin(preNavOrigin)) {
      err(`[nav] Invalid origin: ${preNavOrigin}`)
      out(`Status: ${color('fail', '❌ FAIL')}`)
      out('Detail:')
      out(`  Connected to non-Z-Library origin: ${preNavOrigin}`)
      out('  Make sure Z-Library Desktop is on a Z-Library HTTPS page.')
      await cleanup()
      return
    }
    err(`[nav] Current origin: ${preNavOrigin}`)

    // Same-origin check before navigation
    const parsedTarget = new URL(targetUrl)
    if (parsedTarget.origin !== preNavOrigin) {
      err(`[nav] Cross-origin navigation rejected: ${parsedTarget.origin} !== ${preNavOrigin}`)
      out(`Status: ${color('fail', '❌ FAIL')}`)
      out('Detail:')
      out(`  Target origin ${parsedTarget.origin} does not match current page ${preNavOrigin}.`)
      out('  Navigate to the correct Z-Library site first.')
      await cleanup()
      return
    }

    err(`[nav] Navigating to ${targetUrl}...`)
    await page.goto(targetUrl, { timeout: 30000 })
    err('[nav] Page loaded.')
  } catch (err_) {
    err(`[nav] Navigation failed: ${err_.message}`)
    out(`Status: ${color('fail', '❌ FAIL')}`)
    out('Detail:')
    out(`  Could not navigate to: ${targetUrl}`)
    out(`  Error: ${err_.message}`)
    await cleanup()
    return
  }

  // -----------------------------------------------------------------------
  // Phase 2: Extract /dl/* download link
  // -----------------------------------------------------------------------

  let dlLink = null
  let origin = ''

  try {
    origin = await page.evaluate('window.location.origin')
    dlLink = await page.evaluate(() => {
      const o = window.location.origin
      const links = Array.from(document.querySelectorAll('a[href*="/dl/"]'))
      if (links.length === 0) return null
      for (const link of links) {
        const href = link.getAttribute('href') || link.href || ''
        try {
          const parsed = new URL(href, o)
          if (parsed.origin === o && parsed.protocol === 'https:' && parsed.pathname.startsWith('/dl/')) {
            return parsed.href
          }
        } catch { /* skip invalid */ }
      }
      return null
    })
  } catch (err_) {
    err(`[extract] Failed to extract /dl/ link: ${err_.message}`)
  }

  if (!dlLink) {
    err('[extract] No /dl/* download link found on page.')
    out(`Status: ${color('fail', '❌ FAIL')}`)
    out('Detail:')
    out('  No download link (/dl/<token>) found on the page.')
    out('  Possible causes: quota exhausted, not logged in, page structure changed.')
    await cleanup()
    return
  }

  const dlRelative = new URL(dlLink).pathname + new URL(dlLink).search
  err(`[extract] Download link found: ${sanitizeDlUrl(dlLink)}`)

  // -----------------------------------------------------------------------
  // Phase 3: Set up CDP Fetch with Request + Response patterns
  // -----------------------------------------------------------------------

  /** @type {string|null} */
  let streamRequestId = null
  /** @type {string|null} */
  let dlRequestId = null
  /** @type {string|null} */
  let ioHandle = null
  /** @type {string} */
  let finalCdnUrl = ''
  /** @type {Array<{requestId: string, url: string, statusCode: number}>} */
  const redirectChain = []
  /** @type {Set<string>} */
  const trackedRequestIds = new Set()
  let /** @type {((value: void) => void) | null} */ cdnResolve = null
  let /** @type {((reason: Error) => void) | null} */ cdnReject = null
  const cdnPromise = new Promise((resolve, reject) => {
    cdnResolve = resolve
    cdnReject = reject
  })

  let headersInjected = false
  let desktopAppHeadersSent = false

  const onRequestPaused = async (paused) => {
    if (!paused || !paused.requestId) return
    const requestId = paused.requestId
    const requestUrl = paused.request && typeof paused.request.url === 'string' ? paused.request.url : ''

    // Detect Request vs Response stage: raw CDPBridge events may lack
    // `requestStage` field (missing in raw CDP). When there's no
    // responseStatusCode, it's a Request-stage event.
    const hasResponse = typeof paused.responseStatusCode === 'number' ||
      Array.isArray(paused.responseHeaders) ||
      typeof paused.responseErrorReason === 'string'
    const statusCode = typeof paused.responseStatusCode === 'number' ? paused.responseStatusCode : 0
    const redirectedId = typeof paused.redirectedRequestId === 'string' ? paused.redirectedRequestId : null

    // --- Request stage: inject desktop-app headers (before response) ---
    if (!hasResponse) {
      try {
        const parsed = new URL(requestUrl)
        if (parsed.origin === origin && parsed.pathname.startsWith('/dl/')) {
          err(`[fetch] Request-stage intercepted: ${sanitizeDlUrl(requestUrl)}`)

          const desktopHeaders = buildDesktopAppHeaders()
          desktopAppHeadersSent = true

          // Merge with original headers — continueRequest headers OVERRIDE all
          const originalHeaders = paused.request?.headers ?? []
          const originalEntries = Array.isArray(originalHeaders) ? originalHeaders
            : Object.entries(originalHeaders).map(([k, v]) => ({ name: k, value: String(v) }))
          const extraEntries = Object.entries(desktopHeaders).map(([name, value]) => ({
            name,
            value,
          }))
          const extraNames = new Set(extraEntries.map(h => h.name.toLowerCase()))
          const mergedHeaders = [
            ...originalEntries.filter(h => !extraNames.has(h.name.toLowerCase())),
            ...extraEntries,
          ]

          err(`[fetch] Merging ${originalEntries.length} original + ${extraEntries.length} desktop-app headers`)

          try {
            await page.cdp('Fetch.continueRequest', {
              requestId,
              headers: mergedHeaders,
            })
            headersInjected = true
            err('[fetch] Headers injected via continueRequest')
          } catch (continueErr) {
            err(`[fetch] continueRequest failed: ${continueErr.message}`)
            await page.cdp('Fetch.continueRequest', { requestId }).catch(() => {})
          }
          return
        }
      } catch { /* unparseable URL — pass through */ }

      try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* ignore */ }
      return
    }

    // --- Response stage: track chain, stream final CDN 200 ---

    // Track initial /dl/ request
    if (!dlRequestId) {
      try {
        const parsed = new URL(requestUrl)
        if (parsed.origin === origin && parsed.pathname.startsWith('/dl/')) {
          dlRequestId = requestId
          trackedRequestIds.add(requestId)
          err(`[fetch] Response-stage dl/ paused: ${sanitizeDlUrl(requestUrl)} (status ${statusCode})`)
        }
      } catch { /* ignore */ }
    }

    // Determine if this request is part of our tracked download chain
    const isTracked = trackedRequestIds.has(requestId) ||
      (redirectedId !== null && trackedRequestIds.has(redirectedId)) ||
      requestId === streamRequestId

    if (!isTracked) {
      try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* pass through */ }
      return
    }

    // Redirect hop (3xx)
    if (statusCode >= 300 && statusCode < 400) {
      redirectChain.push({ requestId, url: requestUrl, statusCode })
      trackedRequestIds.add(requestId)
      err(`[fetch] Redirect ${statusCode}: ${sanitizeDlUrl(requestUrl)} -> redirectedId=${redirectedId || 'none'}`)
      try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* ignore */ }
      return
    }

    // Final CDN response (200)
    if (statusCode === 200) {
      streamRequestId = requestId
      finalCdnUrl = requestUrl
      trackedRequestIds.add(requestId)
      err(`[fetch] CDN 200: ${sanitizeDlUrl(requestUrl)}`)
      if (cdnResolve) cdnResolve()
      return
    }

    // Unexpected — pass through
    try { await page.cdp('Fetch.continueRequest', { requestId }) } catch { /* ignore */ }
    if (cdnReject) cdnReject(new Error('Unexpected response status: ' + statusCode))
  }

  try {
    bridge.on('Fetch.requestPaused', onRequestPaused)

    // Enable Fetch with BOTH patterns in a single call (like cdp-fetch-transport.js).
    // Single Fetch.enable avoids pattern-merge issues across multiple calls.
    err('[fetch] Enabling Fetch (Response: *, Request: /dl/*)...')
    try {
      await page.cdp('Fetch.enable', {
        patterns: [
          { urlPattern: '*', requestStage: 'Response' },
          { urlPattern: `${origin}/dl/*`, requestStage: 'Request' },
        ],
      })
      err('[fetch] Fetch.enable (both patterns) OK')
    } catch (fetchErr) {
      // Fallback: try Response-only pattern (legacy CDP targets)
      err(`[fetch] Fetch.enable (both) failed: ${fetchErr.message}. Trying Response-only...`)
      try {
        await page.cdp('Fetch.enable', {
          patterns: [{ urlPattern: '*', requestStage: 'Response' }],
        })
        err('[fetch] Fetch.enable (Response-only) OK')
      } catch (fallbackErr) {
        err(`[fetch] Fetch.enable (Response-only) FAILED: ${fallbackErr.message}`)
        out(`Status: ${color('fail', '❌ FAIL')}`)
        out('Detail:')
        out('  Fetch domain not available on this target.')
        await bridge.off('Fetch.requestPaused', onRequestPaused)
        await cleanup()
        return
      }
    }

    // -----------------------------------------------------------------------
    // Phase 4: Trigger download via anchor click
    // -----------------------------------------------------------------------

    err('[fetch] Triggering download via hidden anchor click...')
    try {
      await page.evaluate((urlRelative) => {
        const a = document.createElement('a')
        a.href = urlRelative
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }, dlRelative)
    } catch { /* navigation aborted by Fetch — expected */ }

    err('[fetch] Waiting for CDN 200 response...')

    // Wait for CDN 200 or timeout
    let timedOut = false
    await Promise.race([
      cdnPromise,
      new Promise((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error('Timed out waiting for CDN 200 response')) }, PROBE_TIMEOUT)
      ),
    ]).catch((err_) => {
      err(`[fetch] ${err_.message}`)
    })

    if (timedOut || !streamRequestId) {
      out(`Status: ${color('fail', '❌ FAIL')}`)
      out('Detail:')
      out('  Timed out waiting for CDN 200 response.')
      out('  The download link may have expired or the session is invalid.')
      out(`  Redirect chain: ${redirectChain.length} hops`)
      if (dlRequestId) out(`  Initial /dl/ paused: yes`)
      out(`  Desktop-app headers injected: ${desktopAppHeadersSent ? 'yes' : 'no'}`)
      out(`  Timeout: ${PROBE_TIMEOUT}ms`)
      await page.cdp('Fetch.disable').catch(() => {})
      bridge.off('Fetch.requestPaused', onRequestPaused)
      await cleanup()
      return
    }

    // -----------------------------------------------------------------------
    // Phase 5: Stream response body to temp file
    // -----------------------------------------------------------------------

    err('[fetch] Taking response body as stream...')
    let streamResult
    try {
      streamResult = await page.cdp('Fetch.takeResponseBodyAsStream', {
        requestId: streamRequestId,
      })
    } catch (streamErr) {
      err(`[fetch] takeResponseBodyAsStream failed: ${streamErr.message}`)
      out(`Status: ${color('fail', '❌ FAIL')}`)
      out('Detail:')
      out(`  Could not capture response body stream.`)
      out(`  Error: ${streamErr.message}`)
      await page.cdp('Fetch.disable').catch(() => {})
      bridge.off('Fetch.requestPaused', onRequestPaused)
      await cleanup()
      return
    }

    ioHandle = streamResult.stream || streamResult.handle || ''
    if (!ioHandle) {
      err('[fetch] No stream handle returned')
      out(`Status: ${color('fail', '❌ FAIL')}`)
      out('Detail:')
      out('  takeResponseBodyAsStream returned no handle.')
      await page.cdp('Fetch.disable').catch(() => {})
      bridge.off('Fetch.requestPaused', onRequestPaused)
      await cleanup()
      return
    }

    // Ensure temp dir and prepare output path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const bookSlug = new URL(targetUrl).pathname.replace(/\/book\//, '').replace(/\/.*$/, '') || 'unknown'
    const outputFileName = `probe-${bookSlug}-${timestamp}.epub`
    const outputPath = path.join(PROBE_RESULTS_DIR, outputFileName)
    const fixtureFileName = `probe-${bookSlug}-${timestamp}.json`
    const fixturePath = path.join(PROBE_RESULTS_DIR, fixtureFileName)

    fs.mkdirSync(PROBE_RESULTS_DIR, { recursive: true })

    err(`[fetch] Streaming to ${outputPath}...`)

    // IO.read loop with incremental file write
    const writeFd = fs.openSync(outputPath, 'w')
    let totalBytes = 0
    let iterations = 0

    try {
      while (true) {
        const chunk = await page.cdp('IO.read', { handle: ioHandle, size: IO_READ_CHUNK })
        if (chunk && chunk.data) {
          const buf = chunk.base64Encoded
            ? Buffer.from(chunk.data, 'base64')
            : Buffer.from(chunk.data, 'utf-8')
          fs.writeSync(writeFd, buf)
          totalBytes += buf.length
        }
        if (chunk && chunk.eof) break
        iterations++
        if (iterations > MAX_IO_ITERATIONS) {
          err('[fetch] IO.read: max iterations exceeded')
          break
        }
      }
    } finally {
      fs.closeSync(writeFd)
    }

    // Suppress browser native download AFTER streaming is complete.
    // failRequest aborts the connection — calling it before streaming
    // truncates the response body to whatever was buffered.
    err(`[fetch] Stream complete: ${formatBytes(totalBytes)} (${totalBytes} bytes), ${iterations} reads`)
    err('[fetch] Suppressing browser native download...')
    try {
      await page.cdp('Fetch.failRequest', {
        requestId: streamRequestId,
        errorReason: 'Aborted',
      })
      err('[fetch] Native download suppressed.')
    } catch { /* best-effort */ }

    // -----------------------------------------------------------------------
    // Phase 6: Report results
    // -----------------------------------------------------------------------

    const isStub = totalBytes < STUB_THRESHOLD
    const isReal = totalBytes >= REAL_BOOK_MIN
    const detectedFormat = totalBytes > 0 ? detectFormat(outputPath) : 'empty'

    // Build CDN URL info (redacted)
    const cdnRedacted = sanitizeDlUrl(finalCdnUrl)

    out('')
    if (isReal) {
      out(`Status: ${color('pass', '✅ PASS')}`)
    } else if (isStub) {
      out(`Status: ${color('fail', '❌ FAIL (stub)')}`)
    } else {
      out(`Status: ${color('warn', '⚠️ PARTIAL')}`)
    }

    out('Detail:')
    out(`  Download URL: ${sanitizeDlUrl(dlLink)}`)
    if (cdnRedacted) out(`  CDN URL: ${cdnRedacted}`)
    out(`  File size: ${totalBytes} bytes (${formatBytes(totalBytes)})`)
    out(`  Detected format: ${detectedFormat}`)
    out(`  Desktop-app headers injected: ${desktopAppHeadersSent ? '✓' : '✗'}`)
    out(`  Redirect chain: ${redirectChain.length} hops`)
    if (redirectChain.length > 0) {
      for (const hop of redirectChain) {
        out(`    → ${hop.statusCode}: ${sanitizeDlUrl(hop.url) || hop.url.substring(0, 80)}`)
      }
    }
    out(`  File saved: ${outputPath}`)

    if (isStub) {
      out('')
      out('  ⚠️ File is a stub (< 4KB). Likely causes:')
      out('    - CDN rate-limiting or IP soft block')
      out('    - Account-level download limit reached')
      out('    - Desktop-app header values rejected by server')
      out('    - Session cookie mismatch')
    }

    if (desktopAppHeadersSent && isReal) {
      out('')
      out('  ✅ Desktop-app header injection enabled real download.')
      out('  This confirms the server accepts desktop-app-* headers from CDP Fetch.')
    }

    if (desktopAppHeadersSent && isStub) {
      out('')
      out('  ❓ Desktop-app headers were injected but result is still a stub.')
      out('  Server may require specific header values or additional headers.')
      out('  Check server response headers via Network panel.')
    }

    // -----------------------------------------------------------------------
    // Phase 7: Save fixture
    // -----------------------------------------------------------------------

    const startedAt = new Date().toISOString()

    const fixture = {
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      command: process.argv.slice(1).join(' '),
      targetUrl: sanitizeDlUrl(targetUrl) || targetUrl,
      dlUrl: sanitizeDlUrl(dlLink),
      cdnUrl: cdnRedacted,
      cdpEndpoint: process.env.OPENCLI_CDP_ENDPOINT || '(default)',
      result: {
        fileSize: totalBytes,
        isStub,
        isReal,
        detectedFormat,
        desktopAppHeadersInjected: desktopAppHeadersSent,
        headersInjectedViaContinueRequest: headersInjected,
        redirectChainHops: redirectChain.length,
        redirectChain: redirectChain.map(h => ({
          statusCode: h.statusCode,
          url: sanitizeDlUrl(h.url) || h.url,
        })),
      },
      outputFile: outputPath,
      fixtureFile: fixturePath,
    }

    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2))
    out(`  Fixture saved: ${fixturePath}`)
    out('')

    // Cleanup
    await page.cdp('Fetch.disable').catch(() => {})
    bridge.off('Fetch.requestPaused', onRequestPaused)

  } catch (err_) {
    err(`[probe] Fatal error: ${err_.message}`)
    out(`Status: ${color('fail', '❌ FAIL')}`)
    out('Detail:')
    out(`  Unexpected error: ${err_.message}`)
  } finally {
    // IO handle cleanup
    if (ioHandle) {
      try { await page.cdp('IO.close', { handle: ioHandle }) } catch { /* best-effort */ }
    }
    cleanFetchDone = true
    try { await page.cdp('Fetch.disable') } catch { /* best-effort */ }
    try {
      bridge.off('Fetch.requestPaused', onRequestPaused)
    } catch { /* best-effort */ }
    await bridge.close().catch(() => {})
    process.exit(0)
  }
}

runProbe().catch((err_) => {
  console.error('Fatal:', err_.message)
  process.exit(1)
})
