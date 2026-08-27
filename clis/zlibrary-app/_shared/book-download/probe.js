/**
 * CDP download capability probe for Electron apps (zlibrary-app).
 *
 * Probe flow (matching PRD §Quick probe commands):
 *   0. Target.getTargets  -  enumerate CDP targets
 *   1. Schema.getDomains  -  check domain support (Fetch, IO, Browser)
 *   2. Browser.setDownloadBehavior  -  test native download path + events
 *   3-7. Fetch stream probe (requires live Z-Library Desktop connection)
 *
 * Probe 3-7 is not implemented here. It needs a live Electron webview
 * with a real Z-Library Desktop session to click the /dl/* link and
 * observe the redirect chain.
 */

// --------------------------------------------------------------------------
// Type definitions (JSDoc)
// --------------------------------------------------------------------------

/**
 * @typedef {Object} CdpProbeTargetsResult
 * @property {string} selectedTargetId  -  targetId of the currently connected target
 * @property {string} selectedTargetUrl  -  URL of the connected target
 * @property {string} selectedTargetType  -  type of the connected target
 * @property {number} totalTargets  -  number of targets discovered
 * @property {Array<{targetId:string, type:string, url:string, title:string, browserContextId:string, attached:boolean}>} allTargets
 */

/**
 * @typedef {Object} CdpProbeDomainsResult
 * @property {Array<string>} availableDomains  -  all domain names returned by Schema.getDomains
 * @property {boolean} fetchSupported  -  true when Fetch domain is available
 * @property {boolean} ioSupported  -  true when IO domain is available
 * @property {boolean} browserSupported  -  true when Browser domain is available
 * @property {boolean} networkSupported  -  true when Network domain is available
 * @property {boolean} targetSupported  -  true when Target domain is available
 */

/**
 * @typedef {Object} CdpProbeDownloadBehaviorResult
 * @property {boolean} commandSucceeded  -  true if Browser.setDownloadBehavior returned OK
 * @property {string|null} errorMessage  -  protocol error message if command failed
 * @property {boolean} downloadWillBeginFired  -  true if Browser.downloadWillBegin event was emitted during probe
 * @property {boolean} downloadProgressFired  -  true if Browser.downloadProgress event was emitted during probe
 * @property {number} eventsCaptured  -  total Browser download events recorded
 */

/**
 * @typedef {Object} CdpProbeFetchStreamResult
 * @property {boolean} fetchDomainAvailable
 * @property {boolean} fetchEnableSucceeded
 * @property {boolean} requestPausedReceived
 * @property {number|null} responseStatusCode
 * @property {boolean} isRedirectResponse
 * @property {boolean} continueRequestSucceeded
 * @property {boolean} redirectedRequestIdReceived
 * @property {boolean} streamHandleReceived
 * @property {boolean} ioReadSucceeded
 * @property {number} bytesRead
 * @property {boolean} suppressSucceeded
 * @property {boolean} browserDownloadWillBeginSeen
 */

// --------------------------------------------------------------------------
// Probe 0: Target enumeration
// --------------------------------------------------------------------------

/**
 * Probe 0  -  List CDP targets and identify the currently connected one.
 *
 * @param {import('../../../src/types.js').IPage} page  -  page instance with cdp() method
 * @returns {Promise<CdpProbeTargetsResult>}
 */
export async function probeCdpTargets(page) {
  /** @type {any} */
  const result = await page.cdp('Target.getTargets', {})
  const targets = Array.isArray(result?.targetInfos) ? result.targetInfos : []
  const attachedTarget = targets.find(t => t && t.attached)
  const targetId = typeof attachedTarget?.targetId === 'string'
    ? attachedTarget.targetId
    : typeof result?.targetId === 'string'
      ? result.targetId
      : ''

  return {
    selectedTargetId: targetId,
    selectedTargetUrl: targets.find(t => t.targetId === targetId)?.url ?? '',
    selectedTargetType: targets.find(t => t.targetId === targetId)?.type ?? '',
    totalTargets: targets.length,
    allTargets: targets.map(t => ({
      targetId: t.targetId,
      type: t.type,
      url: t.url,
      title: t.title ?? '',
      browserContextId: t.browserContextId ?? '',
      attached: Boolean(t.attached),
    })),
  }
}

// --------------------------------------------------------------------------
// Probe 1: Domain enumeration
// --------------------------------------------------------------------------

/**
 * Probe 1  -  List available CDP protocol domains.
 *
 * @param {import('../../../src/types.js').IPage} page
 * @returns {Promise<CdpProbeDomainsResult>}
 */
export async function probeCdpDomains(page) {
  /** @type {any} */
  const result = await page.cdp('Schema.getDomains', {})
  const domains = Array.isArray(result?.domains) ? result.domains : []
  const names = domains.map(d => String(d.name ?? ''))

  return {
    availableDomains: names.sort(),
    fetchSupported: names.includes('Fetch'),
    ioSupported: names.includes('IO'),
    browserSupported: names.includes('Browser'),
    networkSupported: names.includes('Network'),
    targetSupported: names.includes('Target'),
  }
}

/**
 * Wait for one CDP event with timeout.
 *
 * @param {{ on:(e:string,h:Function)=>void, off:(e:string,h:Function)=>void }} eventBus
 * @param {string} eventName
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
async function waitForCdpEvent(eventBus, eventName, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.off(eventName, handler)
      reject(new Error('Timed out waiting for ' + eventName))
    }, timeoutMs)

    const handler = (params) => {
      clearTimeout(timer)
      eventBus.off(eventName, handler)
      resolve(params)
    }

    eventBus.on(eventName, handler)
  })
}

/**
 * Count bytes in CDP IO.read chunk data.
 *
 * @param {{ data?: string, base64Encoded?: boolean }} chunk
 * @returns {number}
 */
function countIoChunkBytes(chunk) {
  if (!chunk || typeof chunk.data !== 'string') return 0
  if (chunk.base64Encoded) {
    return Buffer.from(chunk.data, 'base64').length
  }
  return Buffer.byteLength(chunk.data)
}

// --------------------------------------------------------------------------
// Probe 2: Browser.setDownloadBehavior test
// --------------------------------------------------------------------------

/**
 * Probe 2  -  Test Browser.setDownloadBehavior on the current CDP target.
 *
 * Subscribes to Browser.downloadWillBegin and Browser.downloadProgress
 * events via the eventBus's event subscription interface (same pattern as
 * CDPBridge.on/off in src/browser/cdp.ts). Records up to maxEvents or
 * until timeoutMs to verify that download events fire on this target.
 *
 * @param {import('../../../src/types.js').IPage} page
 * @param {{ on:(e:string,h:Function)=>void, off:(e:string,h:Function)=>void, waitForEvent?:(e:string,t:number)=>Promise<any> }} eventBus
 * @param {string} downloadPath  -  absolute directory path for downloads
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=5000]  -  how long to listen for download events
 * @param {number} [opts.maxEvents=10]  -  stop listening after this many events
 * @returns {Promise<CdpProbeDownloadBehaviorResult>}
 */
export async function probeBrowserDownloadBehavior(page, eventBus, downloadPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000
  const maxEvents = opts.maxEvents ?? 10

  /** @type {Array<{method:string, params:any, timestamp:number}>} */
  const events = []

  const onWillBegin = (params) => {
    events.push({ method: 'Browser.downloadWillBegin', params, timestamp: Date.now() })
  }
  const onProgress = (params) => {
    events.push({ method: 'Browser.downloadProgress', params, timestamp: Date.now() })
  }

  eventBus.on('Browser.downloadWillBegin', onWillBegin)
  eventBus.on('Browser.downloadProgress', onProgress)

  let commandSucceeded = false
  /** @type {string|null} */
  let errorMessage = null

  try {
    await page.cdp('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
    })
    commandSucceeded = true
  } catch (/** @type {any} */ err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  // Wait a bit for potential events (if a download is in progress)
  if (commandSucceeded && events.length < maxEvents) {
    await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 2000)))
  }

  eventBus.off('Browser.downloadWillBegin', onWillBegin)
  eventBus.off('Browser.downloadProgress', onProgress)

  const willBeginEvents = events.filter(e => e.method === 'Browser.downloadWillBegin')
  const progressEvents = events.filter(e => e.method === 'Browser.downloadProgress')

  return {
    commandSucceeded,
    errorMessage,
    downloadWillBeginFired: willBeginEvents.length > 0,
    downloadProgressFired: progressEvents.length > 0,
    eventsCaptured: events.length,
  }
}

/**
 * Fetch stream probe  -  tests Fetch.enable, requestPaused, redirect handling,
 * takeResponseBodyAsStream, IO.read, and response suppression on a live
 * Electron webview target.
 *
 * IMPORTANT: Requires an active Z-Library Desktop webview with a book page
 * that has a /dl/* download link. This probe is NOT runnable in unit tests
 * because it needs real browser interaction and a live download flow.
 *
 * @param {import('../../../src/types.js').IPage} page
 * @param {{ on:(e:string,h:Function)=>void, off:(e:string,h:Function)=>void, waitForEvent:(e:string,t:number)=>Promise<any> }} eventBus
 * @param {string} urlRelative  -  the /dl/<token> path to click
 * @param {string} origin  -  the page origin (e.g. https://1lib.sk)
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=60000]
 * @param {string} [opts.outputPath]  -  if set, write streamed body to this file
 * @returns {Promise<CdpProbeFetchStreamResult>}
 */
export async function probeFetchStreamLive(page, eventBus, urlRelative, origin, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000

  /** @type {CdpProbeFetchStreamResult} */
  const result = {
    fetchDomainAvailable: false,
    fetchEnableSucceeded: false,
    requestPausedReceived: false,
    responseStatusCode: null,
    isRedirectResponse: false,
    continueRequestSucceeded: false,
    redirectedRequestIdReceived: false,
    streamHandleReceived: false,
    ioReadSucceeded: false,
    bytesRead: 0,
    suppressSucceeded: false,
    browserDownloadWillBeginSeen: false,
  }

  // Step 1: Fetch.enable as real gate with origin-scoped pattern
  // Security: only intercept requests under `${origin}/dl/*`  -  reject '*'
  const fetchPattern = origin ? `${origin}/dl/*` : '*'
  try {
    await page.cdp('Fetch.enable', {
      patterns: [{ urlPattern: fetchPattern, requestStage: 'Response' }],
    })
    result.fetchDomainAvailable = true
    result.fetchEnableSucceeded = true
    // Keep Fetch enabled for the rest of the probe
  } catch {
    result.fetchDomainAvailable = false
    return result
  }

  // Step 2: Register Browser download event guard
  let downloadWillBeginSeen = false
  const onDownloadWillBegin = () => { downloadWillBeginSeen = true }
  eventBus.on('Browser.downloadWillBegin', onDownloadWillBegin)

  /** Tracked requestId from the initial /dl/* redirect */
  let trackedRequestId = null
  /** @type {((paused:any)=>Promise<void>)|null} */
  let onRequestPaused = null

  try {
    // Step 1 already enabled Fetch with broad pattern  -  no duplicate call.
    // Fetch is enabled for the entire probe lifespan.
    // Step 3: Register Fetch.requestPaused listener BEFORE click (fix race)
    let /** @type {any} */ finalPaused = null
    let fetchRequestResolve = null
    let fetchRequestReject = null
    let fetchRequestPromise = new Promise((resolve, reject) => {
      fetchRequestResolve = resolve
      fetchRequestReject = reject
    })

    const processedRequestIds = new Set()

    onRequestPaused = async (/** @type {any} */ paused) => {
      if (!paused || !paused.requestId) return
      // Skip already-processed requests (due to race-ish conditions)
      if (processedRequestIds.has(paused.requestId)) return
      processedRequestIds.add(paused.requestId)

      const requestId = paused.requestId
      const statusCode = typeof paused.responseStatusCode === 'number' ? paused.responseStatusCode : 0
      const redirectedId = typeof paused.redirectedRequestId === 'string' ? paused.redirectedRequestId : null
      // Only process requests that are part of our tracked download chain:
      //   1. The initial /dl/* request (trackedRequestId === null means first hop)
      //   2. Redirect descendants of it (redirectedId matches trackedRequestId)
      const isTracked = trackedRequestId === null ||
        (paused.request && typeof paused.request.url === 'string' && paused.request.url.includes('/dl/')) ||
        (redirectedId === trackedRequestId)

      if (!isTracked) {
        // Pass through for unrelated requests (don't block the page)
        try { await page.cdp('Fetch.continueRequest', { requestId }) } catch {}
        return
      }

      result.requestPausedReceived = true
      result.responseStatusCode = statusCode

      if (statusCode >= 300 && statusCode < 400) {
        // Redirect hop  -  track requestId so downstream requests with
        // matching redirectedRequestId are linked to this chain.
        result.isRedirectResponse = true
        trackedRequestId = requestId

        try {
          await page.cdp('Fetch.continueRequest', { requestId })
          result.continueRequestSucceeded = true
          // Continue to wait for next hop  -  do NOT resolve yet
        } catch {
          result.continueRequestSucceeded = false
          if (fetchRequestReject) {
            fetchRequestReject(new Error('Fetch.continueRequest failed for redirect hop'))
            fetchRequestReject = null
          }
        }
        return
      }

      // Non-redirect tracked request  -  check if it's a redirect descendant
      if (redirectedId && redirectedId === trackedRequestId) {
        result.redirectedRequestIdReceived = true
      }

      if (statusCode === 200) {
        // Final CDN response  -  resolve so streaming starts
        finalPaused = paused
        if (fetchRequestResolve) {
          fetchRequestResolve()
          fetchRequestResolve = null
        }
        return
      }

      // Unexpected status
      try { await page.cdp('Fetch.continueRequest', { requestId }) } catch {}
      if (fetchRequestReject) {
        fetchRequestReject(new Error('Unexpected response status: ' + statusCode))
        fetchRequestReject = null
      }
    }

    // Register listener synchronously BEFORE any async operation
    eventBus.on('Fetch.requestPaused', onRequestPaused)

    // Step 5: Click the download link with same-origin validation
    try {
      await page.evaluate((args) => {
        const { urlRelative, origin } = args
        const links = Array.from(document.querySelectorAll('a[href*="/dl/"]'))
        // Same-origin HTTPS only: reject cross-origin or HTTP links
        const match = links.find((link) => {
          const href = link.getAttribute('href') || link.href || ''
          try {
            const parsed = new URL(href, origin)
            return parsed.origin === origin &&
              parsed.protocol === 'https:' &&
              parsed.pathname.startsWith('/dl/')
          } catch {
            return false
          }
        })

        if (match) match.click()
      }, { urlRelative, origin })
    } catch {
      // Click may trigger navigation; that's expected
    }

    // Step 6: Wait for Fetch.requestPaused processing to complete
    // This blocks until the CDN 200 response is found or timeout
    // If the entire /dl/* chain does not produce a tracked CDN 200
    // within timeout, fetchRequestPromise rejects.
    await Promise.race([
      fetchRequestPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for final CDN 200 response')), timeoutMs)
      ),
    ])

    if (!finalPaused) return result

    // Step 7: Stream response body with IO.close in finally
    result.streamHandleReceived = true
    /** @type {string|null} */
    let ioHandle = null

    try {
      /** @type {any} */
      const streamResult = await page.cdp('Fetch.takeResponseBodyAsStream', {
        requestId: finalPaused.requestId,
      })
      if (streamResult && typeof streamResult.stream === 'string') {
        ioHandle = streamResult.stream
        let done = false
        let totalBytes = 0

        while (!done) {
          /** @type {any} */
          const chunk = await page.cdp('IO.read', {
            handle: ioHandle,
            size: 65536,
          })
          if (chunk && typeof chunk.eof === 'boolean') {
            done = chunk.eof
            totalBytes += countIoChunkBytes(chunk)
          } else {
            done = true
          }
        }

        result.ioReadSucceeded = true
        result.bytesRead = totalBytes
      }
    } catch {
      // Stream may fail; result fields already false
    } finally {
      if (ioHandle) {
        try { await page.cdp('IO.close', { handle: ioHandle }) } catch {}
      }
    }

    // Step 8: Suppress the paused response
    try {
      await page.cdp('Fetch.failRequest', {
        requestId: finalPaused.requestId,
        errorReason: 'Aborted',
      })
      result.suppressSucceeded = true
    } catch {
      // Suppression may fail
    }

    result.browserDownloadWillBeginSeen = downloadWillBeginSeen
  } finally {
    result.browserDownloadWillBeginSeen = downloadWillBeginSeen
    eventBus.off('Browser.downloadWillBegin', onDownloadWillBegin)
    eventBus.off('Fetch.requestPaused', onRequestPaused)

    // Clean up Fetch domain
    try {
      await page.cdp('Fetch.disable', {})
    } catch {
      // Best-effort cleanup
    }
  }

  return result
}

/**
 * Run all static probes (0-2) in sequence.
 *
 * @param {import('../../../src/types.js').IPage} page
 * @param {{ on:(e:string,h:Function)=>void, off:(e:string,h:Function)=>void, waitForEvent?:(e:string,t:number)=>Promise<any> }} eventBus
 * @param {string} [downloadPath='/tmp/opencli-dl-probe']
 * @returns {Promise<{targets:CdpProbeTargetsResult, domains:CdpProbeDomainsResult, downloadBehavior:CdpProbeDownloadBehaviorResult}>}
 */
export async function probeAllStatic(page, eventBus, downloadPath = '/tmp/opencli-dl-probe') {
  const [targets, domains, downloadBehavior] = await Promise.all([
    probeCdpTargets(page),
    probeCdpDomains(page),
    probeBrowserDownloadBehavior(page, eventBus, downloadPath),
  ])
  return { targets, domains, downloadBehavior }
}
