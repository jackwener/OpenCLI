/**
 * Quota Checker for Z-Library Desktop App.
 *
 * Provides proactive daily download quota checking by extracting quota
 * information from the /users/downloads page DOM, with a local counter
 * to avoid repeated navigation.
 *
 * Data flow:
 *   1. extractQuotaFromDom(page)  -  navigates to /users/downloads, extracts quota from DOM
 *   2. createQuotaTracker()  -  factory returning a tracker with local counter (V1, backward compat)
 *   3. createQuotaLedgerTracker(page, ledger)  -  factory returning a tracker with persistent
 *      ledger (V2, integrates QuotaLedger for cross-process quota tracking)
 *   4. tracker.ensure(page)  -  lazy init + periodic resync (every 5 consumes)
 *   5. tracker.consume(n)  -  decrements local counter after successful download
 *   6. tracker.isExhausted()  -  checks if quota is exhausted
 *
 * URL Security Boundary:
 *   - Internal: relative URLs only (/users/downloads)
 *   - DOM extraction: resolves relative URLs to absolute against window.location.origin
 *   - Output: absolute http(s) URLs (handled by callers)
 *
 * V2 Integration:
 *   - DOM is downgraded to bootstrap source (countText, resetText)
 *   - QuotaLedger is the source of truth for downloadedToday
 *   - getRemaining() uses MAX(DOM.used, ledger.downloadedToday) for conservative estimate
 *   - resetAt-based rollover: when resetAt timestamp passes, counter auto-resets
 */

import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from '../infra/url-boundary.js'
import { hasMd5InFilenameFormat } from '../infra/md5-format.js'
import { CommandExecutionError } from '@jackwener/opencli/errors'
import { QuotaLedger } from './ledger.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Resync interval: re-fetch quota from DOM after this many consume() calls */
const RESYNC_INTERVAL = 5

// ---------------------------------------------------------------------------
// DOM Extraction
// ---------------------------------------------------------------------------

/**
 * Extract quota information from the /users/downloads page DOM.
 *
 * Navigates to the downloads page, validates same-origin and login wall,
 * then extracts quota data and filename format info from the DOM.
 *
 * Also detects whether the user's profile filename template includes
 * {md5} or __MD5_  -  this indicates the CDN redirect URL will contain
 * __MD5_<32hex>__ in the filename param for download completion verification.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{
 *   countText: string,
 *   resetText: string,
 *   progressExists: boolean,
 *   progressAriaNow: number|null,
 *   parsedCount: { used: number|null, limit: number|null, remaining: number|null },
 *   filenameFormatText: string
 * }>}
 * @throws {CommandExecutionError} If navigation fails or login wall detected
 */
// Design Note: Doctor probes use this fixture-shaped extractor; read commands
// derive parsed quota rows from the same DOM payload.
export async function extractQuotaSnapshotFromDom(page) {
  const snapshot = await extractQuotaSnapshotWithFilenameFromDom(page)
  const { filenameFormatText: _filenameFormatText, ...fixturePayload } = snapshot
  return fixturePayload
}

async function extractQuotaSnapshotWithFilenameFromDom(page) {
  // Get and validate current origin
  const startOrigin = await getCurrentHttpOrigin(page)

  // Navigate to downloads page (must use absolute URL for CDP Page.navigate)
  const downloadsUrl = new URL('/users/downloads', startOrigin.origin).href
  await page.goto(downloadsUrl, { waitUntil: 'load', settleMs: 3000 })

  // Validate same-origin and not login wall after navigation
  await assertSameOriginNotLoginWall(page, startOrigin, 'zlibrary-app quota')

  return extractQuotaSnapshotFromCurrentDom(page)
}

export async function extractQuotaFromDom(page) {
  const snapshot = await extractQuotaSnapshotWithFilenameFromDom(page)
  const parsedCount = snapshot.parsedCount || { used: null, limit: null, remaining: null }

  return {
    dailyUsed: parsedCount.used,
    dailyLimit: parsedCount.limit,
    dailyRemaining: parsedCount.remaining,
    resetText: snapshot.resetText || '',
    progressAriaNow: snapshot.progressAriaNow,
    filenameFormatText: snapshot.filenameFormatText || '',
    hasMd5InFilenameFormat: hasMd5InFilenameFormat(snapshot.filenameFormatText || '')
  }
}

async function extractQuotaSnapshotFromCurrentDom(page) {
  const quotaData = await page.evaluate(`(() => {
    const countEl = document.querySelector('.dstats-info .d-count')
    const resetEl = document.querySelector('.dstats-info .d-reset')
    const progressBar = document.querySelector('.dstats-info .progress-bar')

    const countText = countEl ? countEl.textContent.trim() : ''
    const resetText = resetEl ? resetEl.textContent.replace(/\\s+/g, ' ').trim() : ''
    const progressAriaNow = progressBar ? Number(progressBar.getAttribute('aria-valuenow')) : null

    // Extract raw filename format text from DOM (analyzed in Node space below)
    const ffEl = document.querySelector('#download-filename-format');
    const filenameFormatText = ffEl ? ffEl.textContent.trim() : '';

    return {
      countText: countText,
      resetText: resetText,
      progressExists: !!progressBar,
      progressAriaNow: progressAriaNow,
      filenameFormatText: filenameFormatText
    }
  })()`)

  return normalizeQuotaSnapshotPayload(quotaData)
}

function normalizeQuotaSnapshotPayload(quotaData) {
  const data = quotaData && typeof quotaData === 'object' ? quotaData : {}
  let countText = String(data.countText || '')

  const parsedCount = parseCountText(countText)
  const progressExists = Boolean(data.progressExists)
  const progressAriaNow = data.progressAriaNow !== null && data.progressAriaNow !== undefined
    ? Number(data.progressAriaNow)
    : null

  return {
    countText: countText,
    resetText: data.resetText || '',
    progressExists: progressExists,
    progressAriaNow: progressAriaNow,
    parsedCount: parsedCount,
    filenameFormatText: data.filenameFormatText || '',
  }
}

function parseCountText(countText) {
  const match = String(countText || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) {
    return { used: null, limit: null, remaining: null }
  }

  const used = Number(match[1])
  const limit = Number(match[2])
  return {
    used: used,
    limit: limit,
    remaining: Math.max(limit - used, 0),
  }
}

// ---------------------------------------------------------------------------
// Quota Tracker Factory
// ---------------------------------------------------------------------------

/**
 * Create a quota tracker with local counter and periodic DOM resync.
 *
 * @returns {{
 *   remaining: number|null,
 *   dailyLimit: number|null,
 *   dailyUsed: number|null,
 *   resetText: string,
 *   lastSync: number|null,
 *   quotaExpired: boolean,
 *   consumeCount: number,
 *   hasMd5InFilenameFormat: boolean,
 *   sync: (page) => Promise<void>,
 *   consume: (n?: number) => void,
 *   ensure: (page) => Promise<void>,
 *   isExhausted: () => boolean
 * }}
 */
export function createQuotaTracker() {
  const tracker = {
    remaining: null,
    dailyLimit: null,
    dailyUsed: null,
    resetText: '',
    lastSync: null,
    quotaExpired: false,
    consumeCount: 0,
    hasMd5InFilenameFormat: false,
    sync: null, // Will be assigned below
    consume: null,
    ensure: null,
    isExhausted: null
  }

  /**
   * Sync quota from DOM, resetting local counter.
   * @param {import('@jackwener/opencli/browser').BrowserPage} page
   */
  async function sync(page) {
    console.warn('[booklist-download]', JSON.stringify({
      phase: 'quota_sync_start',
      reason: tracker.lastSync === null ? 'first_sync' : 'periodic_resync',
      consumeCount: tracker.consumeCount,
    }))
    const data = await extractQuotaFromDom(page)
    tracker.remaining = data.dailyRemaining
    tracker.dailyLimit = data.dailyLimit
    tracker.dailyUsed = data.dailyUsed
    tracker.resetText = data.resetText
    tracker.hasMd5InFilenameFormat = !!data.hasMd5InFilenameFormat
    tracker.lastSync = Date.now()
    tracker.consumeCount = 0
    tracker.quotaExpired = tracker.remaining !== null && tracker.remaining <= 0
    console.warn('[booklist-download]', JSON.stringify({
      phase: 'quota_sync_done',
      remaining: tracker.remaining,
      dailyLimit: tracker.dailyLimit,
      dailyUsed: tracker.dailyUsed,
      resetText: tracker.resetText,
      quotaExpired: tracker.quotaExpired,
    }))
  }

  /**
   * Decrement local quota counter.
   * @param {number} [n=1] - Number of downloads to consume
   */
  function consume(n = 1) {
    if (tracker.remaining !== null) {
      tracker.remaining = Math.max(tracker.remaining - n, 0)
      if (tracker.remaining <= 0) {
        tracker.quotaExpired = true
      }
    }
    // Track dailyUsed for telemetry accuracy
    if (tracker.dailyUsed !== null) {
      tracker.dailyUsed += n
    }
    tracker.consumeCount += n
  }

  /**
   * Ensure quota is initialized and resync if needed.
   * Syncs on first call, then every RESYNC_INTERVAL consume() calls.
   * @param {import('@jackwener/opencli/browser').BrowserPage} page
   */
  async function ensure(page) {
    // If quota already known exhausted, don't resync
    if (tracker.quotaExpired) {
      return
    }

    // First sync or periodic resync
    const shouldSync = tracker.lastSync === null || tracker.consumeCount >= RESYNC_INTERVAL
    if (shouldSync) {
      await tracker.sync(page)
    }
  }

  /**
   * Check if quota is exhausted (remaining <= 0).
   * Returns false if quota is unknown (null) to avoid false blocking.
   * @returns {boolean}
   */
  function isExhausted() {
    return tracker.remaining !== null && tracker.remaining <= 0
  }

  // Assign functions to tracker
  tracker.sync = sync
  tracker.consume = consume
  tracker.ensure = ensure
  tracker.isExhausted = isExhausted

  return tracker
}

// ---------------------------------------------------------------------------
// Reset text parser
// ---------------------------------------------------------------------------

/**
 * Parse a DOM reset text like "Downloads will be reset in 14h 5m" into an
 * absolute ISO timestamp.
 *
 * Handles several format variants observed across Z-Library sites.
 *
 * @param {string} resetText - Raw text from .dstats-info .d-reset
 * @returns {string|null} ISO 8601 timestamp or null if unparseable
 */
export function parseResetTextToAbsolute(resetText) {
  if (!resetText) return null

  // Pattern: "Xh Ym" or "X hours Y minutes" or "Xh" only
  const hourMatch = resetText.match(/(\d+)\s*h(?:ours?)?\s*/i)
  const minMatch = resetText.match(/(\d+)\s*m(?:in(?:ute)?s?)?\s*/i)

  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0
  const minutes = minMatch ? parseInt(minMatch[1], 10) : 0

  if (hours === 0 && minutes === 0) return null

  const future = new Date(Date.now() + hours * 3600000 + minutes * 60000)
  return future.toISOString()
}

// ---------------------------------------------------------------------------
// Ledger-backed Quota Tracker Factory (V2)
// ---------------------------------------------------------------------------

/**
 * Create a quota tracker backed by a persistent QuotaLedger.
 *
 * Same interface as createQuotaTracker() but persists downloadedToday
 * across process restarts via the ledger file.
 *
 * Flow:
 *   1. sync(page): navigate to DOM → extract dailyLimit, resetAt → bootstrap
 *      ledger if needed → setDomUsed → check resetAt rollover → update
 *      remaining from ledger.getRemaining()
 *   2. consume(n): ledger.consume(n) + ledger.save() + update tracker state
 *   3. isExhausted(): delegate to ledger.getRemaining()
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {QuotaLedger} ledger
 * @returns {{
 *   remaining: number|null,
 *   dailyLimit: number|null,
 *   dailyUsed: number|null,
 *   resetText: string,
 *   lastSync: number|null,
 *   quotaExpired: boolean,
 *   consumeCount: number,
 *   ledger: QuotaLedger,
 *   sync: (page) => Promise<void>,
 *   consume: (n?: number) => void,
 *   ensure: (page) => Promise<void>,
 *   isExhausted: () => boolean
 * }}
 */
export async function createQuotaLedgerTracker(page, ledger) {
  const tracker = {
    remaining: null,
    dailyLimit: null,
    dailyUsed: null,
    resetText: '',
    lastSync: null,
    quotaExpired: false,
    consumeCount: 0,
    ledger,
  }

  /**
   * Sync from DOM, bootstrap ledger if needed, update remaining.
   * @param {import('@jackwener/opencli/browser').BrowserPage} _page
   */
  async function sync(_page) {
    console.warn('[booklist-download]', JSON.stringify({
      phase: 'quota_sync_start',
      reason: tracker.lastSync === null ? 'first_sync' : 'periodic_resync',
      consumeCount: tracker.consumeCount,
    }))

    const data = await extractQuotaFromDom(_page)

    // Bootstrap ledger if it has no data yet
    if (data.dailyLimit != null && ledger.ledger == null) {
      const resetAt = parseResetTextToAbsolute(data.resetText || '')
      ledger.bootstrap(data.dailyLimit, resetAt)
      try { ledger.save() } catch (_) { /* non-fatal: continue with in-memory values */ }
    }

    // Refresh resetAt for existing ledgers (DOM is authoritative for reset timing)
    if (ledger.ledger && data.resetText) {
      const newResetAt = parseResetTextToAbsolute(data.resetText)
      if (newResetAt) {
        ledger.ledger.resetAt = newResetAt
      }
    }

    // Update DOM-side used value
    if (data.dailyUsed != null) {
      ledger.setDomUsed(data.dailyUsed)
    }

    // Persist ledger state after DOM update (non-fatal if fails)
    try { ledger.save() } catch (_) { /* non-fatal */ }

    // Check for resetAt rollover before computing remaining
    ledger.ensureResetRollover()

    // Update tracker display fields from ledger
    tracker.remaining = ledger.getRemaining()
    tracker.dailyLimit = ledger.ledger ? ledger.ledger.dailyLimit : data.dailyLimit
    tracker.dailyUsed = ledger.domUsed != null ? ledger.domUsed : data.dailyUsed
    tracker.resetText = data.resetText || ''
    tracker.lastSync = Date.now()
    tracker.consumeCount = 0
    tracker.quotaExpired = tracker.remaining !== null && tracker.remaining <= 0

    console.warn('[booklist-download]', JSON.stringify({
      phase: 'quota_sync_done',
      remaining: tracker.remaining,
      dailyLimit: tracker.dailyLimit,
      dailyUsed: tracker.dailyUsed,
      resetText: tracker.resetText,
      domDownloadedToday: data.dailyUsed,
      ledgerDownloadedToday: ledger.ledger ? ledger.ledger.downloadedToday : null,
      quotaExpired: tracker.quotaExpired,
    }))
  }

  /**
   * Decrement quota counter and persist to ledger.
   * @param {number} [n=1]
   */
  function consume(n = 1) {
    ledger.consume(n)
    try { ledger.save() } catch (_) { /* non-fatal: continue with in-memory values */ }

    if (tracker.remaining !== null) {
      tracker.remaining = Math.max(tracker.remaining - n, 0)
      if (tracker.remaining <= 0) {
        tracker.quotaExpired = true
      }
    }
    // Track dailyUsed for telemetry accuracy (ledger tracks downloadedToday)
    if (tracker.dailyUsed !== null) {
      tracker.dailyUsed += n
    }
    tracker.consumeCount += n
  }

  /**
   * Ensure tracker is initialized for ledger-backed flow.
   * Always syncs on first call; afterwards resyncs periodically
   * (every RESYNC_INTERVAL consume() calls) to refresh DOM.
   * @param {import('@jackwener/opencli/browser').BrowserPage} _page
   */
  async function ensure(_page) {
    // Always check resetAt rollover FIRST (fast, no DOM navigation).
    // Must happen before any quotaExpired check to unblock when the
    // reset timestamp has passed (e.g., user was blocked overnight).
    if (ledger.ledger && ledger.ledger.resetAt) {
      const rolledOver = ledger.ensureResetRollover()
      if (rolledOver) {
        tracker.remaining = ledger.getRemaining()
        tracker.quotaExpired = tracker.remaining !== null && tracker.remaining <= 0
      }
    }

    if (tracker.quotaExpired) {
      return
    }

    const shouldSync = tracker.lastSync === null || tracker.consumeCount >= RESYNC_INTERVAL
    if (shouldSync) {
      await tracker.sync(_page)
    } else {
      // Update remaining from ledger without DOM navigation
      tracker.remaining = ledger.getRemaining()
      tracker.quotaExpired = tracker.remaining !== null && tracker.remaining <= 0
    }
  }

  /**
   * Check if quota is exhausted.
   * @returns {boolean}
   */
  function isExhausted() {
    if (ledger.ledger) {
      const remaining = ledger.getRemaining()
      return remaining !== null && remaining <= 0
    }
    return tracker.remaining !== null && tracker.remaining <= 0
  }

  // Initial sync from ledger (fast, no DOM navigation)
  if (ledger.ledger) {
    tracker.remaining = ledger.getRemaining()
    tracker.dailyLimit = ledger.ledger.dailyLimit
    tracker.dailyUsed = ledger.domUsed != null ? ledger.domUsed : ledger.ledger.downloadedToday
    tracker.lastSync = null // will trigger first DOM sync on ensure()
    tracker.quotaExpired = tracker.remaining !== null && tracker.remaining <= 0
  }

  tracker.sync = sync
  tracker.consume = consume
  tracker.ensure = ensure
  tracker.isExhausted = isExhausted

  return tracker
}

// ---------------------------------------------------------------------------
// Convenience Factory
// ---------------------------------------------------------------------------

/**
 * Convenience factory that loads a QuotaLedger from disk (or creates one),
 * builds a ledger-backed tracker, and runs the first ensure() sync.
 *
 * Consolidates the 3-step setup pattern used by download commands:
 *   new QuotaLedger() → load() → createQuotaLedgerTracker() → ensure()
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{ ledger: QuotaLedger, tracker: object }>}
 */
export async function loadQuotaTracker(page, siteDir) {
  const ledger = new QuotaLedger(siteDir)
  ledger.load()
  const tracker = await createQuotaLedgerTracker(page, ledger)
  await tracker.ensure(page)
  return { ledger, tracker }
}
