/**
 * Live probe runner for Z-Library Desktop Electron download capability.
 *
 * DEVELOPMENT USE ONLY  -  connects to a running Z-Library Desktop instance
 * via CDP and runs all download probes (0-7).
 *
 * Usage:
 *   node clis/zlibrary-app/_shared/live-probe-runner.js --url <book-url> --yes-live-download
 *
 * Prerequisites:
 *   - Z-Library Desktop must be running, logged in, on a Z-Library site
 *   - OPENCLI_CDP_ENDPOINT env var must point to the CDP endpoint
 *     (e.g. http://127.0.0.1:9222/json)
 *   - --url must be a Z-Library HTTPS book detail page
 *   - --yes-live-download required to confirm real download action
 *
 * Flags:
 *   --url <bookUrl>       Z-Library book detail URL (REQUIRED)
 *   --yes-live-download   Confirm real download action (REQUIRED)
 *   --output <dir>        Download output directory (default: /tmp/opencli-dl-probe)
 *   --json                Machine-readable JSONL output (human output goes to stderr)
 */

import { CDPBridge } from '@jackwener/opencli/browser/cdp'
import { sanitizeDownloadTraceUrl } from '../book-download/contracts.js'
import { toDownloadUrlRelative } from './url-boundary.js'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed Z-Library top-level domains for safety gate */
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

function phaseLog(phase, data = {}) {
  const line = JSON.stringify({ phase, ...data, timestamp: new Date().toISOString() })
  if (jsonMode) {
    console.log(line)
  } else {
    err(line)
  }
}

function color(status, text) {
  if (status === 'pass') return `\x1b[32m${text}\x1b[0m`
  if (status === 'fail') return `\x1b[31m${text}\x1b[0m`
  if (status === 'warn') return `\x1b[33m${text}\x1b[0m`
  return text
}

function printVerdict(probeName, passed, detail) {
  const icon = passed ? '✓' : '✗'
  const s = passed ? 'pass' : 'fail'
  out(`  ${color(s, icon)} ${probeName}: ${detail}`)
}

/**
 * Validate a Z-Library origin string against allowed domains.
 */
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runLiveProbes() {
  const args = process.argv.slice(2)

  if (args.includes('--json')) jsonMode = true

  const urlFlag = args.find((a, i) => a === '--url' && args[i + 1])
  const targetUrl = urlFlag ? args[args.indexOf('--url') + 1] : null
  const hasConfirm = args.includes('--yes-live-download')
  const outputFlag = args.find((a, i) => a === '--output' && args[i + 1])
  const downloadPath = outputFlag ? args[args.indexOf('--output') + 1] : '/tmp/opencli-dl-probe'

  if (!targetUrl) {
    err('ERROR: --url is required. Provide a Z-Library book detail page URL.')
    process.exit(1)
  }

  if (!isValidZlibOrigin(targetUrl)) {
    err('ERROR: --url must be a Z-Library HTTPS site (allowed origins: z-lib.org, 1lib.sk, etc.)')
    process.exit(1)
  }

  if (!hasConfirm) {
    err('ERROR: --yes-live-download is required. This probe triggers a real download click.')
    err('  Add --yes-live-download to confirm you understand this will consume download quota.')
    process.exit(1)
  }

  phaseLog('start', { targetUrl, downloadPath, jsonMode })

  // Register SIGINT/SIGTERM cleanup
  let bridge = null
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
    if (!jsonMode) err('Cleanup done.')
    process.exit(130)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Step 0: Connect to CDP
  phaseLog('cdp_connect')
  let page
  try {
    bridge = new CDPBridge()
    // timeout=15 → CDPBridge multiplies by 1000 internally, giving ~15s
    page = await bridge.connect({
      timeout: 15,
      surface: 'adapter',
      windowMode: 'foreground',
      preferHttpsTargets: true,
    })
    phaseLog('cdp_connected', { session: page.session })
  } catch (err) {
    phaseLog('cdp_connect_failed', { error: err.message })
    err('\nFailed to connect to CDP. Is Z-Library Desktop running?')
    err('Set OPENCLI_CDP_ENDPOINT to the CDP WebSocket URL.\n')
    process.exit(1)
  }

  // Verify selected target is HTTPS (not file:// shell)
  if (page && typeof page.evaluate === 'function') {
    try {
      const origin = await page.evaluate('window.location.origin')
      if (!isValidZlibOrigin(origin)) {
        phaseLog('invalid_origin', { origin })
        err(`ERROR: Connected to non-Z-Library origin: ${origin}`)
        err('  Make sure Z-Library Desktop is on a Z-Library HTTPS page.')
        await cleanup()
        return
      }
    } catch {
      phaseLog('origin_check_failed')
    }
  }

  // Create event bus wrapper
  const eventBus = {
    on: (event, handler) => bridge.on(event, handler),
    off: (event, handler) => bridge.off(event, handler),
    waitForEvent: (event, timeout) => bridge.waitForEvent(event, timeout),
  }

  const startedAt = new Date().toISOString()

  try {
    // -----------------------------------------------------------------------
    // Probe 0: Target enumeration
    // -----------------------------------------------------------------------
    phaseLog('probe_targets')
    const { probeCdpTargets } = await import('../book-download/probe.js')
    let targetsResult
    try {
      targetsResult = await probeCdpTargets(page)
      printVerdict('Probe 0: Target enumeration', true,
        `${targetsResult.totalTargets} targets, selected: ${targetsResult.selectedTargetType} (${targetsResult.selectedTargetUrl})`)
    } catch (err) {
      printVerdict('Probe 0: Target enumeration', false, err.message)
      targetsResult = null
    }

    // -----------------------------------------------------------------------
    // Probe 1: Domain enumeration
    // -----------------------------------------------------------------------
    phaseLog('probe_domains')
    const { probeCdpDomains } = await import('../book-download/probe.js')
    let domainsResult
    try {
      domainsResult = await probeCdpDomains(page)
      printVerdict('Probe 1: Domain enumeration', true,
        `Fetch=${domainsResult.fetchSupported} IO=${domainsResult.ioSupported} Browser=${domainsResult.browserSupported}`)
    } catch (err) {
      printVerdict('Probe 1: Domain enumeration', false, err.message)
      domainsResult = null
    }

    // -----------------------------------------------------------------------
    // Probe 2: Browser.setDownloadBehavior
    // -----------------------------------------------------------------------
    phaseLog('probe_download_behavior')
    const { probeBrowserDownloadBehavior } = await import('../book-download/probe.js')
    let behaviorResult
    try {
      behaviorResult = await probeBrowserDownloadBehavior(page, eventBus, downloadPath)
      printVerdict('Probe 2: Browser.setDownloadBehavior', behaviorResult.commandSucceeded,
        behaviorResult.commandSucceeded
          ? `OK, events=${behaviorResult.eventsCaptured} willBegin=${behaviorResult.downloadWillBeginFired}`
          : `Failed: ${behaviorResult.errorMessage}`)
    } catch (err) {
      printVerdict('Probe 2: Browser.setDownloadBehavior', false, err.message)
      behaviorResult = null
    }

    // -----------------------------------------------------------------------
    // Probe 3-7: Fetch stream
    // -----------------------------------------------------------------------
    phaseLog('probe_fetch_stream')
    const { probeFetchStreamLive } = await import('../book-download/probe.js')
    let fetchResult = null

    try {
      // Same-origin check before goto: ensure targetUrl is same-origin HTTPS
      const preNavOrigin = await page.evaluate('window.location.origin').catch(() => '')
      if (preNavOrigin) {
        try {
          const parsedTarget = new URL(targetUrl)
          if (parsedTarget.origin !== preNavOrigin) {
            throw new CommandExecutionError('Cross-origin navigation rejected: target ' + parsedTarget.origin + ' !== current ' + preNavOrigin)
          }
          if (parsedTarget.protocol !== 'https:') {
            throw new CommandExecutionError('Non-HTTPS navigation rejected: ' + targetUrl)
          }
        } catch (err) {
          if (err instanceof TypeError) {
            throw new ArgumentError('Invalid target URL: ' + targetUrl)
          }
          throw err
        }
      }
      phaseLog('navigate_to_url', { url: targetUrl })
      await page.goto(targetUrl, { timeout: 30000 })

      // Get current origin and extract /dl/* link (same-origin HTTPS only)
      const origin = await page.evaluate('window.location.origin')
      const dlLink = await page.evaluate(() => {
        const origin = window.location.origin
        const links = Array.from(document.querySelectorAll('a[href*="/dl/"]'))
        if (links.length === 0) return null
        // Same-origin HTTPS /dl/* only  -  reject cross-origin or HTTP links
        for (const link of links) {
          const href = link.getAttribute('href') || link.href || ''
          try {
            const parsed = new URL(href, origin)
            if (parsed.origin === origin && parsed.protocol === 'https:' && parsed.pathname.startsWith('/dl/')) {
              return parsed.href
            }
          } catch { /* skip invalid */ }
        }
        return null
      })

      if (!dlLink) {
        printVerdict('Probe 3-7: Fetch stream', false,
          'No /dl/* link found on page matching target URL.')
      } else {
        const relativePath = toDownloadUrlRelative(dlLink, origin)
        phaseLog('dl_link_found', { urlRelative: relativePath, origin, rawHref: dlLink })

        fetchResult = await probeFetchStreamLive(page, eventBus, relativePath, origin, {
          timeoutMs: 120000,
        })

        printVerdict('Fetch domain available', fetchResult.fetchDomainAvailable, String(fetchResult.fetchDomainAvailable))
        printVerdict('Fetch.enable succeeded', fetchResult.fetchEnableSucceeded, String(fetchResult.fetchEnableSucceeded))
        printVerdict('requestPaused received', fetchResult.requestPausedReceived, String(fetchResult.requestPausedReceived))
        printVerdict('Redirect chain tracked', fetchResult.redirectedRequestIdReceived, String(fetchResult.redirectedRequestIdReceived))
        printVerdict('Stream handle received', fetchResult.streamHandleReceived, String(fetchResult.streamHandleReceived))
        printVerdict('IO.read succeeded', fetchResult.ioReadSucceeded, `${fetchResult.bytesRead} bytes`)
        printVerdict('Response suppressed', fetchResult.suppressSucceeded, String(fetchResult.suppressSucceeded))
        printVerdict('Browser.downloadWillBegin', !fetchResult.browserDownloadWillBeginSeen,
          fetchResult.browserDownloadWillBeginSeen ? 'SEEN (probe failure)' : 'Not seen (good)')
      }
    } catch (err) {
      printVerdict('Probe 3-7: Fetch stream', false, err.message)
    }

    // -----------------------------------------------------------------------
    // Summary  -  separate native download vs fetch stream decisions
    // -----------------------------------------------------------------------
    out('\n=== PROBE SUMMARY ===')

    const nativeDownloadOk = behaviorResult?.commandSucceeded === true
    const fetchStreamOk = fetchResult?.ioReadSucceeded === true
    const fetchDomainOk = fetchResult?.fetchDomainAvailable === true
    const noBrowserEvent = fetchResult ? !fetchResult.browserDownloadWillBeginSeen : null

    out(`  ${color(nativeDownloadOk ? 'pass' : 'fail', nativeDownloadOk ? '✓' : '✗')} Browser.setDownloadBehavior (probe only)`)
    out(`  ${color(fetchDomainOk ? 'pass' : 'fail', fetchDomainOk ? '✓' : '✗')} CDP Fetch/IO domains available`)
    out(`  ${color(fetchStreamOk ? 'pass' : 'fail', fetchStreamOk ? '✓' : '✗')} Fetch stream capture`)
    if (noBrowserEvent !== null) {
      out(`  ${color(noBrowserEvent ? 'pass' : 'fail', noBrowserEvent ? '✓' : '✗')} No Browser.downloadWillBegin during Fetch mode`)
    }

    // Fetch stream decision is independent of Browser.setDownloadBehavior
    const fetchVerdict = fetchDomainOk && fetchStreamOk && (noBrowserEvent !== false)
    out(`\n  Fetch stream transport: ${color(fetchVerdict ? 'pass' : 'fail', fetchVerdict ? 'GO' : 'NO-GO')}`)
    if (!fetchVerdict) {
      if (!fetchDomainOk) out('    Reason: Fetch or IO domain not available on this target')
      else if (!fetchStreamOk) out('    Reason: Stream capture failed (see probe details)')
      else if (noBrowserEvent === false) out('    Reason: Browser download pipeline started (dialog not suppressed)')
    }

    // -----------------------------------------------------------------------
    // Persist probe results
    // -----------------------------------------------------------------------
    const fs = await import('fs')
    const path = await import('path')
    const researchDir = path.join('.trellis', 'tasks', '06-22-eval-live-probe', 'research')
    try { fs.mkdirSync(researchDir, { recursive: true }) } catch {}

    const probeArtifact = {
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      command: process.argv.slice(1).join(' '),
      // Redact /dl/<token> from persisted URLs
      targetUrl: sanitizeDownloadTraceUrl(targetUrl) || targetUrl,
      downloadPath,
      cdpEndpoint: process.env.OPENCLI_CDP_ENDPOINT || '(default)',
      verdict: {
        fetchStreamTransport: fetchVerdict ? 'go' : 'no-go',
        reason: fetchVerdict ? 'Fetch stream capture succeeded' : 'Fetch stream capture failed',
        criteria: {
          fetchDomainAvailable: fetchDomainOk,
          fetchEnableSucceeded: fetchResult?.fetchEnableSucceeded || false,
          requestPausedReceived: fetchResult?.requestPausedReceived || false,
          redirectChainTracked: fetchResult?.redirectedRequestIdReceived || false,
          streamHandleReceived: fetchResult?.streamHandleReceived || false,
          ioReadSucceeded: fetchStreamOk,
          suppressSucceeded: fetchResult?.suppressSucceeded || false,
          browserDownloadWillBeginSeen: fetchResult?.browserDownloadWillBeginSeen || false,
        },
      },
      probes: {
        targets: targetsResult,
        domains: domainsResult,
        downloadBehavior: behaviorResult,
        fetchStream: fetchResult,
      },
    }

    fs.writeFileSync(path.join(researchDir, 'probe-results.json'), JSON.stringify(probeArtifact, null, 2))
    phaseLog('done', { verdict: fetchVerdict ? 'go' : 'no-go' })

  } finally {
    cleanFetchDone = true
    await bridge.close().catch(() => {})
  }
}

runLiveProbes().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
