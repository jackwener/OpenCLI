/**
 * Persistent Quota Ledger for Z-Library Desktop App.
 *
 * Tracks daily download quota in a JSON file at
 * ~/.opencli/sites/zlibrary-app/quota-ledger.json
 * using atomic writes (temp → renameSync) for crash safety.
 *
 * Schema:
 * {
 *   "version": 1,
 *   "date": "2026-06-06",
 *   "dailyLimit": 10,
 *   "downloadedToday": 0,
 *   "resetAt": "2026-06-07T08:05:00.000Z",
 *   "updatedAt": "2026-06-06T18:00:00.000Z"
 * }
 *
 * - `dailyLimit`: bootstrapped from DOM (d-count denominator)
 * - `downloadedToday`: local accumulator (CLI processes only)
 * - `resetAt`: absolute timestamp from DOM d-reset text parse
 * - `remaining` is NOT persisted  -  derived: Math.max(dailyLimit - downloadedToday, 0)
 *
 * getRemaining() uses MAX(DOM.used, ledger.downloadedToday) to be conservative:
 * preferring to under-download rather than over-download.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEDGER_FILENAME = 'quota-ledger.json'
const CURRENT_VERSION = 1

// ---------------------------------------------------------------------------
// QuotaLedger Class
// ---------------------------------------------------------------------------

/**
 * Persistent download quota ledger.
 */
export class QuotaLedger {
  /**
   * @param {string} [siteDir] - Custom site directory (defaults to ~/.opencli/sites/zlibrary-app).
   *   Default is computed lazily at construction time (not import time) so that
   *   tests can set $HOME / mock os.homedir() before constructing instances.
   */
  constructor(siteDir = path.join(os.homedir(), '.opencli', 'sites', 'zlibrary-app')) {
    this.siteDir = siteDir
    this.ledgerPath = path.join(siteDir, LEDGER_FILENAME)
    this.tmpPath = this.ledgerPath + '.tmp'
    this.ledger = null
    this.domUsed = null // Set externally from DOM extraction
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Load ledger from disk.
   * Returns the loaded ledger object, or null if missing/corrupt.
   *
   * @returns {object|null}
   */
  load() {
    try {
      if (!fs.existsSync(this.ledgerPath)) {
        return null
      }
      const raw = fs.readFileSync(this.ledgerPath, 'utf-8')
      const data = JSON.parse(raw)
      if (data && data.version === CURRENT_VERSION && typeof data.dailyLimit === 'number') {
        // Defense: ensure downloadedToday is numeric (prevent string concatenation in consume())
        if (typeof data.downloadedToday !== 'number') {
          data.downloadedToday = 0
        }
        this.ledger = data
        return data
      }
      // Version mismatch or invalid schema  -  treat as corrupt
      return null
    } catch (_) {
      return null
    }
  }

  /**
   * Bootstrap the ledger with values from DOM extraction.
   * Called when no valid ledger exists on disk.
   *
   * @param {number} dailyLimit - From DOM d-count denominator
   * @param {string|null} [resetAt] - Absolute ISO timestamp from d-reset parse
   * @returns {object} The initialized ledger
   */
  bootstrap(dailyLimit, resetAt = null) {
    this.ledger = {
      version: CURRENT_VERSION,
      date: new Date().toISOString().slice(0, 10),
      dailyLimit,
      downloadedToday: 0,
      resetAt: resetAt || null,
      updatedAt: new Date().toISOString(),
    }
    return this.ledger
  }

  /**
   * Save ledger to disk with atomic write (temp → renameSync).
   * Creates the site directory if it doesn't exist.
   *
   * @returns {void}
   */
  save() {
    if (!this.ledger) {
      return
    }
    this.ledger.updatedAt = new Date().toISOString()

    // Ensure site directory exists
    fs.mkdirSync(this.siteDir, { recursive: true })

    // Atomic write: write to .tmp, then renameSync
    fs.writeFileSync(this.tmpPath, JSON.stringify(this.ledger, null, 2), 'utf-8')
    fs.chmodSync(this.tmpPath, 0o600)
    fs.renameSync(this.tmpPath, this.ledgerPath)
  }

  /**
   * Increment the downloaded-today counter.
   *
   * @param {number} [n=1] - Number of downloads to add
   */
  consume(n = 1) {
    if (!this.ledger) return
    this.ledger.downloadedToday = Math.max((this.ledger.downloadedToday || 0) + n, 0)
    // Don't auto-save here  -  caller explicitly calls save() when ready
  }

  /**
   * Check if resetAt has passed and reset the counter if so.
   * Must be called before getRemaining() to ensure accuracy.
   *
   * @returns {boolean} true if a rollover occurred
   */
  ensureResetRollover() {
    if (!this.ledger || !this.ledger.resetAt) return false

    const now = Date.now()
    const resetTime = new Date(this.ledger.resetAt).getTime()

    // Guard against invalid dates (NaN)  -  clear resetAt so it gets re-bootstrapped
    if (!Number.isFinite(resetTime)) {
      this.ledger.resetAt = null
      this.save()
      return false
    }

    if (now >= resetTime) {
      // Reset timer has expired → reset counters
      this.ledger.downloadedToday = 0
      this.ledger.date = new Date().toISOString().slice(0, 10)
      this.ledger.resetAt = null // Will be re-bootstrapped on next DOM visit
      this.save()
      return true
    }
    return false
  }

  /**
   * Get the effective remaining quota, using MAX(DOM.used, ledger.downloadedToday)
   * for the consumed count. This ensures we never over-download.
   *
   * @returns {number|null} remaining downloads, or null if no ledger/dailyLimit
   */
  getRemaining() {
    if (!this.ledger || this.ledger.dailyLimit == null) return null

    const domUsed = this.domUsed ?? 0
    const downloadedToday = this.ledger.downloadedToday ?? 0
    const effectiveUsed = Math.max(domUsed, downloadedToday)
    return Math.max(this.ledger.dailyLimit - effectiveUsed, 0)
  }

  /**
   * Get the DOM-side used value parsed from d-count.
   * Used by callers to set domUsed on the ledger.
   *
   * @param {number|null} used
   */
  setDomUsed(used) {
    this.domUsed = used
  }

  /**
   * Get a display-friendly snapshot of the current ledger state.
   *
   * @returns {object} Plain object with ledger stats
   */
  getStats() {
    if (!this.ledger) {
      return {
        available: false,
        dailyLimit: null,
        downloadedToday: null,
        remaining: null,
        resetAt: null,
        date: null,
        updatedAt: null,
      }
    }

    return {
      available: true,
      dailyLimit: this.ledger.dailyLimit,
      downloadedToday: this.ledger.downloadedToday,
      remaining: this.getRemaining(),
      resetAt: this.ledger.resetAt,
      date: this.ledger.date,
      updatedAt: this.ledger.updatedAt,
    }
  }
}

/**
 * Create or load a QuotaLedger, optionally bootstrapping from DOM data.
 *
 * @param {object} [domData] - Optional DOM quota data for bootstrap
 * @param {number} [domData.dailyLimit]
 * @param {string} [domData.resetAt]
 * @param {number} [domData.dailyUsed]
 * @param {string} [siteDir]
 * @returns {QuotaLedger}
 */
export function createOrLoadLedger(domData, siteDir = path.join(os.homedir(), '.opencli', 'sites', 'zlibrary-app')) {
  const ledger = new QuotaLedger(siteDir)

  // Try loading existing ledger
  const existing = ledger.load()

  if (!existing && domData && domData.dailyLimit != null) {
    // Bootstrap from DOM
    ledger.bootstrap(domData.dailyLimit, domData.resetAt || null)
    ledger.save()
  }

  // Set DOM used value (even if we loaded an existing ledger)
  if (domData && domData.dailyUsed != null) {
    ledger.setDomUsed(domData.dailyUsed)
  }

  return ledger
}
