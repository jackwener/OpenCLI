/**
 * Z-Library Desktop booklist-download command — batch download engine.
 *
 * Downloads all books from a named booklist sequentially, tracking progress
 * via a JSONL manifest file for resume support.
 *
 * Flow per book:
 *   1. Navigate to book detail page via page.goto('/book/{bookId}')
 *   2. Click the three-dot menu to reveal download options
 *   3. Extract the format-specific /dl/ download URL
 *   4. CDP Fetch stream the file to disk via Electron webview (cookies inherited from session)
 *   5. Append completion entry to the JSONL manifest
 *
 * CDP Transport: uses page.on/off for Fetch.requestPaused events, Fetch.takeResponseBodyAsStream
 * for incremental file write with MD5 computation. No separate cookie fetch or Node HTTP client.
 * Cookies are inherited from the CDP-connected browser session.
 *
 * Column layout: ['book', 'author', 'status', 'filename', 'error']
 *
 * Format auto-detection: each book page has exactly one native-format /dl/ link.
 * The format is parsed from the link text (e.g. "pdf, 2.39 MB" → "pdf").
 * --extension flag was removed in v2 — format is always auto-detected.
 *
 * Manifest-based resume: on restart, completed entries are skipped.
 * Single-book failures are retried up to 3 times before proceeding.
 * HTTP 403/429 triggers immediate stop (quota exceeded).
 *
 * MD5 dedup: after download, the file's MD5 is computed and stored in the
 * manifest entry. On resume, --md5-dedup controls whether to skip files
 * whose MD5 matches the manifest; --verify-download controls whether to
 * verify downloaded files against the site-provided MD5 hash.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { appendFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { resolveBooklistByNameOrThrow, getBooklistBooks, getScopeTabUrl } from './_shared/booklist/api.js'
import { extractNativeDownloadLink } from './_shared/book-download/link.js'
import { isCompleted, loadManifest, saveManifestEntry, saveCompletedManifestEntry, verifyCompleted, sanitiseBookId, renderFilenameTemplate, normalizeOutputKeys, readFirstBytes, FILENAME_TEMPLATE_DEFAULT } from './_shared/infra/manifest-helpers.js';
import { validateExtension, EXTS } from '../zlibrary/dom.js';
import { buildBookPageMetadata } from './_shared/book-metadata.js';
import { extractBookMd5 } from './_shared/infra/md5-format.js';
import { detectHtmlBlockContent, isLikelyHtmlPrefix } from './_shared/book-download/contracts.js'
import { MIN_DOWNLOAD_SIZE } from './_shared/book-download/contracts.js'
import { DownloadFixtureRecorder } from './_shared/fixture/index.js'
import { toSameOriginAbsoluteUrl, toDownloadUrlRelative } from './_shared/infra/url-boundary.js'
import { initCdpDownload } from './_shared/book-download/transport.js'
import { loadQuotaTracker } from './_shared/quota/checker.js'
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js'
import { recordCompletedDownload } from './_shared/book-download/workflow.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max retry attempts per single book before giving up */
const MAX_RETRIES = 3
const DEFAULT_BOOK_TIMEOUT_SECONDS = 300 // 5 min per book, overridable via --timeout
const MAX_BOOK_TIMEOUT_SECONDS = 300      // Hard cap: no single book gets more than 5 min
// Uses FILENAME_TEMPLATE_DEFAULT imported from ./utils.js

function toSafeTimeoutSeconds(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BOOK_TIMEOUT_SECONDS
  return Math.min(Math.floor(n), MAX_BOOK_TIMEOUT_SECONDS)
}

function phaseLog(phase, startedAtMs, details = {}) {
  const elapsedMs = Date.now() - startedAtMs
  const payload = {
    phase,
    elapsedMs,
    ...details,
  }
  console.warn('[booklist-download]', JSON.stringify(payload))
}

async function runWithTimeout(task, timeoutMs, label) {
  const controller = new AbortController()
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new CommandExecutionError(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([task(controller.signal), timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Check if an error indicates CDP connection failure (fatal for batch download).
 *
 * Matches both raw CDP errors from cdp.ts ("CDP connection is not open",
 * "CDP connection closed") and wrapped CommandExecutionError messages
 * from download-link.js failAt() which embed the CDP error inside JSON.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isCdpDeathError(err) {
  return err instanceof Error && /CDP connection (is not open|closed)/.test(err.message)
}

function writeCdpDebugLine(debugPath, phase, payload) {
  appendFileSync(debugPath, JSON.stringify({
    ts: new Date().toISOString(),
    phase,
    ...payload,
  }) + '\n', 'utf8')
}

/**
 * Read the active network capture into the CDP debug log.
 * Capture failures are logged, never thrown — debugging must not break downloads.
 */
async function captureDebugSnapshot(page, debugPath, phase, payload = {}) {
  try {
    const entries = await page.readNetworkCapture()
    writeCdpDebugLine(debugPath, phase, { ...payload, entries })
  } catch (error) {
    writeCdpDebugLine(debugPath, phase + '_failed', {
      ...payload,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Navigate to about:blank to clear a stuck Electron webview state.
 * Throws a fatal CommandExecutionError when even the reset fails.
 */
async function resetWebviewOrThrow(page, contextLabel) {
  try {
    await page.goto('about:blank', { timeout: 10000 })
  } catch (resetErr) {
    throw new CommandExecutionError('Fatal: Webview unresponsive ' + contextLabel + '. Aborting. ' + resetErr.message)
  }
}

// ---------------------------------------------------------------------------
// Extracted argument parsing (module-private)
// ---------------------------------------------------------------------------

/**
 * Parse and validate booklist-download CLI arguments.
 *
 * @param {Object} kwargs - raw CLI args
 * @returns {{ name: string, scope: string, resume: boolean, md5Dedup: boolean, verifyDownload: boolean, scanExisting: boolean, scanMd5Suffix: boolean, outputDir: string, manifestPath: string, timeoutSeconds: number, debugCdp: boolean, filenameTemplate: string }}
 * @throws {ArgumentError}
 */
function parseBooklistDownloadArgs (kwargs) {
  const name = String(kwargs.name || '').trim()
  if (!name) {
    throw new ArgumentError(
      'booklist-download name cannot be empty',
      'Example: opencli zlibrary-app booklist-download mylist'
    )
  }

  // Validate scope
  const scope = String(kwargs.scope || 'my').toLowerCase()
  if (!['public', 'favorite', 'my'].includes(scope)) {
    throw new ArgumentError(
      'Invalid scope: ' + scope,
      'Valid scopes: public, favorite, my'
    )
  }

  // --extension was removed in v2 — format is auto-detected from download link text.
  // Reject it explicitly to give users a clear error message.
  if (kwargs.extension != null && kwargs.extension !== '') {
    throw new ArgumentError(
      'booklist-download: --extension is no longer supported. ' +
      'Format is auto-detected from the download link text.'
    )
  }

  const resume = kwargs.resume !== false
  const md5Dedup = kwargs.md5Dedup === true || kwargs['md5-dedup'] === true
  const verifyDownload = kwargs.verifyDownload !== false && kwargs['verify-download'] !== false
  const scanExisting = kwargs.scanExisting !== false && kwargs['scan-existing'] !== false
  const scanMd5Suffix = kwargs.scanMd5Suffix === true || kwargs['scan-md5-suffix'] === true
  const timeoutSeconds = toSafeTimeoutSeconds(kwargs.timeout)
  const debugCdp = kwargs.debugCdp === true || kwargs['debug-cdp'] === true
  const filenameTemplate = String(kwargs['filename-template'] || kwargs.filenameTemplate || FILENAME_TEMPLATE_DEFAULT).trim()

  // Default output: ./downloads/
  // When --list-dir is set, append sanitized list name: ./downloads/<name>/
  const outputBase = String(kwargs.output || './downloads').trim()
  const resolvedBase = path.resolve(outputBase)
  const outputDir = kwargs['list-dir']
    ? path.join(resolvedBase, name.replace(/[^a-zA-Z0-9_-]/g, '_'))
    : resolvedBase

  const manifestPath = path.join(outputDir, 'manifest.jsonl')

  return { name, scope, resume, md5Dedup, verifyDownload, scanExisting, scanMd5Suffix, outputDir, manifestPath, timeoutSeconds, debugCdp, filenameTemplate }
}

// ---------------------------------------------------------------------------
// Resume state loader
// ---------------------------------------------------------------------------

/**
 * Deduplicate manifest entries by book_id — keeps the LAST entry
 * for each book_id, since a book_id maps to exactly one format
 * (different formats have different book IDs on Z-Library).
 *
 * @param {Array<import('./utils.js').ManifestEntry>} entries
 * @returns {Array<import('./utils.js').ManifestEntry>}
 */
function deduplicateManifestByBookId (entries) {
  /** @type {Record<string, import('./utils.js').ManifestEntry>} */
  const map = {}
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    map[entry.book_id] = entry
  }
  return Object.values(map)
}

/**
 * Load manifest and return a Set of completed book_ids
 * that have verified file existence (and optionally MD5).
 *
 * Uses verifyCompleted() for robust checking — verifies file exists,
 * is a regular file, and checks MD5 when options.md5Dedup is true.
 *
 * @param {string} manifestPath
 * @param {string} outputDir
 * @param {{ md5Dedup?: boolean }} [options]
 * @returns {Promise<Set<string>>} Set of completed book_ids
 */
async function loadResumeState (manifestPath, outputDir, options = {}) {
  const startedAt = Date.now()
  const manifestEntries = loadManifest(manifestPath)
  let completedCandidates = 0
  for (let i = 0; i < manifestEntries.length; i++) {
    if (isCompleted(manifestEntries[i]) && manifestEntries[i].filename) completedCandidates++
  }
  phaseLog('load_resume_state_manifest', startedAt, {
    totalEntries: manifestEntries.length,
    completedCandidates,
  })

  const entries = deduplicateManifestByBookId(manifestEntries)
  phaseLog('load_resume_state_deduped', startedAt, { dedupedEntries: entries.length })

  let total = 0
  for (let i = 0; i < entries.length; i++) {
    if (isCompleted(entries[i]) && entries[i].filename) total++
  }
  phaseLog('resume_verify_start', startedAt, { total })

  const completedIds = new Set()
  const resolvedOutput = path.resolve(outputDir)

  for (let i = 0; i < entries.length; i++) {
    if (!isCompleted(entries[i])) continue
    if (!entries[i].filename) continue
    if (i % 10 === 0) {
      phaseLog('resume_verify_progress', startedAt, {
        index: i + 1,
        total,
        currentBookId: entries[i].book_id,
      })
    }

    // Use verifyCompleted for robust file verification and optional MD5 verification
    const { ok, reason } = await verifyCompleted(
      { ...entries[i], status: 'completed' },
      resolvedOutput,
      { checkMd5: Boolean(options.md5Dedup) }
    )

    if (ok) {
      completedIds.add(entries[i].book_id)
    } else if (reason === 'empty' || reason === 'too_small') {
      // Remove zero-byte or undersize files (stubs, block pages)
      try { unlinkSync(path.resolve(resolvedOutput, entries[i].filename)) } catch (_) {}
    }

    if (!ok) {
      phaseLog('resume_verify_entry', startedAt, {
        index: i + 1,
        bookId: entries[i].book_id,
        ok,
        reason,
      })
    }
  }

  return completedIds
}

// ---------------------------------------------------------------------------
// Display row builder
// ---------------------------------------------------------------------------

/**
 * Build a consistent result row for the CLI output table.
 *
 * @param {{ title?: string, author?: string }} book
 * @param {string} status - 'downloaded', 'skipped', or 'failed'
 * @param {string} filename
 * @param {string} error
 * @returns {{ book: string, author: string, status: string, filename: string, error: string }}
 */
function toResultRow (book, status, filename, error) {
  return {
    book: book.title || '',
    author: book.author || '',
    status: status,
    filename: filename,
    error: error || ''
  }
}

// ---------------------------------------------------------------------------
// Manifest entry helpers
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a download URL against the site origin.
 * Returns the full absolute URL or null if invalid.
 *
 * Now delegates to toSameOriginAbsoluteUrl from url-boundary.js.
 *
 * @param {string} downloadUrl
 * @param {string} siteOrigin
 * @returns {string|null}
 */
function validateDownloadUrl (downloadUrl, siteOrigin) {
  if (!downloadUrl) return null
  const result = toSameOriginAbsoluteUrl(downloadUrl, siteOrigin)
  return result || null
}

/**
 * Create a pending manifest entry.
 * @param {object} overrides
 * @returns {object}
 */
function makeManifestEntry (overrides) {
  return {
    book_id: '',
    title: '',
    author: '',
    language: '',
    extension: '',
    filename: '',
    file_size: null,
    md5: null,
    status: 'pending',
    error: null,
    attempted_at: null,
    completed_at: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

cli({
  site: 'zlibrary-app',
  name: 'booklist-download',
  access: 'write',
  description: 'Batch download all books from a Z-Library booklist',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      type: 'string',
      help: 'Booklist name'
    },
    {
      name: 'output',
      type: 'string',
      help: 'Output directory (default: ./downloads/)'
    },
    {
      name: 'list-dir',
      type: 'boolean',
      default: false,
      help: 'Append sanitized booklist name as subdirectory (e.g. ./downloads/<name>/)'
    },
    {
      name: 'scope',
      type: 'string',
      default: 'my',
      help: 'Booklist scope: public, favorite, my'
    },
    {
      name: 'resume',
      type: 'boolean',
      default: true,
      help: 'Skip already-downloaded books (disable with --no-resume)'
    },
    {
      name: 'md5-dedup',
      type: 'boolean',
      default: false,
      help: 'During resume, skip files whose MD5 matches the manifest — slow'
    },
    {
      name: 'verify-download',
      type: 'boolean',
      default: true,
      help: 'After download, verify file integrity against site-provided MD5 hash (use --no-verify-download to skip)'
    },
    {
      name: 'scan-existing',
      type: 'boolean',
      default: true,
      help: 'During resume, skip download if exact filename already exists on disk (uses current filename template)'
    },
    {
      name: 'scan-md5-suffix',
      type: 'boolean',
      default: false,
      help: 'During resume, scan output directory for files containing __MD5_<hash> suffix to skip download (catches old-format files)'
    },
    {
      name: 'timeout',
      type: 'int',
      default: DEFAULT_BOOK_TIMEOUT_SECONDS,
      help: 'Per-book timeout in seconds, capped at 300'
    },
    {
      name: 'debug-cdp',
      type: 'boolean',
      default: false,
      help: 'Capture CDP network traffic to outputDir/cdp-debug.jsonl'
    },
    {
      name: 'fixture',
      type: 'boolean',
      default: false,
      help: 'Save a download telemetry fixture for offline diagnosis'
    },
    {
      name: 'filename-template',
      type: 'string',
      default: FILENAME_TEMPLATE_DEFAULT,
      help: 'Filename template. Keys: {id} {title} {author} {md5} {language-code} {format-quality-rating}. Extension auto-appended.'
    }
  ],
  columns: ['book', 'author', 'status', 'filename', 'error'],
  func: async (page, kwargs) => {
    const lock = await acquireLockOrThrow('zlibrary-app booklist-download')
    try {
    // -- 1. Parse & validate args -------------------------------------
    const { name, scope, resume, md5Dedup, verifyDownload, scanExisting, scanMd5Suffix, outputDir, manifestPath, timeoutSeconds, debugCdp, filenameTemplate } = parseBooklistDownloadArgs(kwargs)
    const fixtureFlag = Boolean(kwargs.fixture || false)
    const timeoutMs = timeoutSeconds * 1000
    const debugPath = path.join(outputDir, 'cdp-debug.jsonl')

    await mkdir(outputDir, { recursive: true })
    if (typeof page.setDefaultTimeout === 'function') {
      await page.setDefaultTimeout(timeoutMs)
    }

    if (debugCdp) {
      try {
        await page.startNetworkCapture('/papi/')
        writeCdpDebugLine(debugPath, 'capture_start', { timeoutSeconds })
      } catch (error) {
        writeCdpDebugLine(debugPath, 'capture_start_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // -- 2. Resolve booklist ------------------------------------------
    const resolveStartedAt = Date.now()
    const match = await runWithTimeout(
      async () => resolveBooklistByNameOrThrow(page, name),
      timeoutMs,
      'resolve booklist'
    )
    phaseLog('resolve_booklist', resolveStartedAt, { booklistId: match.id })

    // -- 3. Discover booklist detail page & extract slug URLs via DOM --
    // Searches `/booklists/my?searchQuery={title}` for the <z-booklist>
    // element (light DOM), extracts its `href` (the real detail URL like
    // /booklist/{id}/{hash}/{slug}.html), navigates there, then extracts
    // all <a href="/book/{slug}/..."> book URLs.  Handles "load more"
    // pagination automatically.  Numeric /book/{id} navigation fails in
    // the Desktop App, so slug URLs from the DOM are essential.
    const listStartedAt = Date.now()
    const books = await runWithTimeout(
      async () => getBooklistBooks(page, match.id, { name: match.title, expectedCount: match.bookCount, scope }),
      timeoutMs,
      'load booklist books'
    )
    phaseLog('load_book_ids', listStartedAt, { count: books ? books.length : 0 })

    if (debugCdp) {
      await captureDebugSnapshot(page, debugPath, 'after_booklist_resolve')
    }

    if (!books || !books.length) {
      return []
    }

    // Hard guard: refuse numeric /book/{id} fallback — user confirmed it
    // fails in the Desktop App.  Every book must have a slug URL from the
    // DOM extraction on the booklist detail page.
    const missingUrls = books.filter(function (b) { return !b.url })
    if (missingUrls.length) {
      throw new CommandExecutionError(
        'DOM extraction returned ' + missingUrls.length +
        ' books without slug URLs for booklist "' + name + '"; ' +
        'refusing numeric /book/{id} fallback which never works in the Desktop App.'
      )
    }

    // -- 4. Get site origin & session cookie --------------------------
    const siteOriginStartedAt = Date.now()
    phaseLog('get_site_origin_start', siteOriginStartedAt)
    const siteOrigin = String(await runWithTimeout(
      async () => page.evaluate('window.location.origin'),
      5000,
      'get site origin'
    ) || '')
    phaseLog('get_site_origin_done', siteOriginStartedAt)

    // -- 5. Load manifest for resume ----------------------------------
    const loadResumeStartedAt = Date.now()
    phaseLog('load_resume_state_start', loadResumeStartedAt, { resume })
    const completedIds = resume
      ? await loadResumeState(manifestPath, outputDir, { md5Dedup })
      : new Set()
    phaseLog('load_resume_state_done', loadResumeStartedAt, { completedCount: completedIds.size })

    // -- 6. Build completed book_id Set for O(1) dedup ----------------
    // Seed dedup set from resume-verified completed IDs; then add newly
    // downloaded books during this run.
    const existingCompletedBookIds = new Set(Array.from(completedIds).map(sanitiseBookId))

    // -- 7. Process each book sequentially ----------------------------
    const results = []
    let quotaExceeded = false
    let consecutiveBlockPages = 0
    let consecutiveGated204 = 0
    let completed = 0
    let failed = 0
    let skipped = 0
    const total = books.length

    // -- 7a. Initialize proactive quota tracker (V2 - ledger-backed) ---
    // Uses persistent QuotaLedger with MAX(DOM, ledger) for remaining.
    // Reactive quota detection (HTTP 403/429) remains as fallback.
    const { tracker: quotaTracker } = await loadQuotaTracker(page)
    phaseLog('quota_tracker_init', Date.now(), {
      remaining: quotaTracker.remaining,
      dailyLimit: quotaTracker.dailyLimit,
      dailyUsed: quotaTracker.dailyUsed,
    })

    // Fail closed if quota status is unknown (DOM extraction returned null).
    // Z-Library daily limit is 10 — running without quota guard causes
    // excessive HTTP requests, leading to HTTP 204 rate-limiting.
    if (quotaTracker.remaining === null) {
      const msg = 'Quota DOM extraction returned null — cannot determine remaining downloads'
      console.warn('[booklist-download]', JSON.stringify({
        phase: 'quota_unknown_abort',
        remaining: quotaTracker.remaining,
        reason: msg,
      }))
      throw new CommandExecutionError(msg)
    }

    phaseLog('start_book_loop', Date.now(), { total })

    // Per-reason skip counters for download summary
    let skippedByBookIdMatch = 0
    let skippedByResume = 0
    let skippedByQuota = 0
    let skippedByGated = 0
    const cdnMd5Stats = { matched: 0, mismatched: 0, unavailable: 0 }

    for (let i = 0; i < books.length; i++) {
      const book = books[i]
      console.warn('[booklist-download]', JSON.stringify({ phase: 'book_start', bookId: book.bookId, index: i + 1, total }))
      const bookId = String(book.bookId || '')

      // Manifest-based dedup: if a completed entry already exists for this book_id,
      // skip it in this run.
      if (existingCompletedBookIds.has(sanitiseBookId(bookId))) {
        skippedByBookIdMatch++
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'bookid_match_skipped',
          bookId,
          index: i + 1,
          total,
          reason: 'completed_in_manifest',
        }))
        results.push(toResultRow(book, 'skipped', '', 'bookid_match'))
        skipped++
        continue
      }

      // Resume: skip already-completed books (keyed on book_id only —
      // a book_id maps to exactly one format on Z-Library)
      if (resume && completedIds.has(bookId)) {
        skippedByResume++
        results.push(toResultRow(book, 'skipped', '', 'resume'))
        skipped++
        continue
      }

       // Quota: skip remaining books when quota exceeded (reactive or proactive)
       if (quotaExceeded || quotaTracker.isExhausted()) {
         const skipReason = consecutiveGated204 >= 3 ? 'download_engine_gated' : 'quota_exceeded'
         if (skipReason === 'download_engine_gated') {
           skippedByGated++
         } else {
           skippedByQuota++
         }
         console.warn('[booklist-download]', JSON.stringify({
           phase: 'quota_skipped',
           bookId,
           index: i + 1,
           total,
           remaining: quotaTracker.remaining,
           dailyLimit: quotaTracker.dailyLimit,
           dailyUsed: quotaTracker.dailyUsed,
         }))
         results.push(toResultRow(book, 'skipped', '', skipReason))
        skipped++
        continue
      }

      // -- Pre-navigation dedup by bookId --
      // Scan output directory for an existing real file matching this bookId.
      // Runs before any webview navigation or download link extraction,
      // avoiding unnecessary CDP calls and quota waste on already-downloaded
      // books that the manifest-based dedup missed.
      if (bookId) {
        const prededupStartedAt = Date.now()
        let prededupFilename = null
        let prededupMd5 = null
        try {
          const safeId = sanitiseBookId(bookId)
          const entries = readdirSync(outputDir)
          for (let ei = 0; ei < entries.length; ei++) {
            const f = entries[ei]
            const fullPath = path.join(outputDir, f)
            let fstat
            try {
              fstat = statSync(fullPath)
              if (!fstat.isFile()) continue
            } catch (_) { continue }

            // Match: bookId_ prefix, _bookId_, -bookId_, or _ID{bookId}_ embedded
            if (!f.startsWith(safeId + '_') && !f.includes('_' + safeId + '_') && !f.includes('-' + safeId + '_') && !f.includes('_ID' + safeId + '_')) continue

            // Reject empty or too-small files (stubs, block pages)
            if (fstat.size < MIN_DOWNLOAD_SIZE) {
              try { unlinkSync(fullPath) } catch (_) {}
              continue
            }

            // Sniff content — reject HTML block/download-limit pages
            try {
              const sample = readFirstBytes(fullPath, 4096)
              if (isLikelyHtmlPrefix(sample)) {
                const blockInfo = detectHtmlBlockContent(sample, { fileSize: fstat.size })
                console.warn('[booklist-download]', JSON.stringify({
                  phase: 'prededup_html_block',
                  bookId,
                  title: blockInfo.title,
                  type: blockInfo.type,
                  keywords: blockInfo.keywords,
                  signals: blockInfo.signals,
                  filename: f,
                }))
                try { unlinkSync(fullPath) } catch (_) {}
                continue
              }
            } catch (_) { continue }

            // Valid file found
            prededupFilename = f
            const md5Match = f.match(/_ID[\w-]+_([a-f0-9]{32})/i)
            prededupMd5 = md5Match ? md5Match[1].toLowerCase() : null
            break
          }
        } catch (_) {
          phaseLog('md5_dedup_unavailable', Date.now(), { bookId, reason: 'scan_error' })
        }

        if (prededupFilename) {
          const prededupFileStat = statSync(path.join(outputDir, prededupFilename))
          const ext = (prededupFilename.split('.').pop() || '').toLowerCase()
          phaseLog('dedup_bookid_scan', prededupStartedAt, { bookId, found: true, filename: prededupFilename })
          saveCompletedManifestEntry(manifestPath, {
            book_id: bookId,
            title: book.title || '',
            author: book.author || '',
            language: book.language || '',
            extension: ext,
            filename: prededupFilename,
            file_size: prededupFileStat.size,
            md5: prededupMd5,
          })
          existingCompletedBookIds.add(sanitiseBookId(bookId))
          results.push(toResultRow(book, 'downloaded', prededupFilename, ''))
          completed++
          continue
        } else {
          phaseLog('dedup_bookid_scan', prededupStartedAt, { bookId, found: false })
        }
      } else {
        phaseLog('md5_dedup_unavailable', Date.now(), { bookId, reason: 'empty_bookId' })
      }

      // -- Webview health check before extraction --
      // Detects stuck webview state (after 404/error pages) and resets it
      // before attempting navigation to the next book's page.
      try {
        await page.evaluate('1+1', { timeout: 5000 })
      } catch (_) {
        await resetWebviewOrThrow(page, 'at book start')
      }

      // -- Per-book lifecycle: navigate_book -- pass checks, begin navigation
      console.warn('[booklist-download]', JSON.stringify({
        phase: 'navigate_book',
        bookId,
        index: i + 1,
        total,
        url: book.url || '',
      }))

      // -- 7a. Get format download URL (outside retry — one-time op) --
      let downloadUrl = null
      let detectedFormat = null
      let validatedUrl = null
      let urlRelativeValue = null
      try {
        // Debug: log per-book navigation state
        if (debugCdp) {
          const pageUrl = await page.evaluate('window.location.href').catch(() => 'unknown')
          process.stderr.write(`[booklist-dl] book ${i+1}/${total} id=${bookId} url="${book.url}" currentUrl="${pageUrl}"\n`)
        }

        const extractStartedAt = Date.now()
        const result = await runWithTimeout(
          async () => extractNativeDownloadLink(page, bookId, {
            timeoutMs,
            origin: siteOrigin,
            debug: debugCdp,
            targetUrl: book.url,
          }),
          timeoutMs,
          'extract native download link for book ' + bookId
        )
        phaseLog('extract_download_link', extractStartedAt, { bookId })

        if (debugCdp) {
          await captureDebugSnapshot(page, debugPath, 'after_extract_link', { bookId })
        }

        if (!result) {
          throw new CommandExecutionError(
            'Could not find download link on book page ' + bookId
          )
        }

        downloadUrl = result.url
        detectedFormat = result.format
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'download_link_extracted',
          bookId,
          urlPath: downloadUrl,
          format: detectedFormat,
          source: result.source,
          label: result.label || '',
          siteOrigin,
        }))

        validatedUrl = validateDownloadUrl(downloadUrl, siteOrigin)
        if (!validatedUrl) {
          throw new CommandExecutionError(
            'Invalid download URL for book ' + bookId + ': ' + downloadUrl
          )
        }

        // Convert absolute validated URL to relative for CDP Fetch request.
        // urlRelativeValue is the /dl/ path used in urlRelative field.
        urlRelativeValue = toDownloadUrlRelative(validatedUrl, siteOrigin)
      } catch (err) {
        // CDP infrastructure failure is fatal — abort immediately.
        // Prevents cascading 500+ failed manifest entries per run.
        if (isCdpDeathError(err)) {
          throw new CommandExecutionError('Fatal: CDP connection lost during extraction. ' + err.message)
        }

        // Format extraction failure — no retry, report immediately
        saveManifestEntry(manifestPath, makeManifestEntry({
          book_id: bookId,
          title: book.title || '',
          author: book.author || '',
          language: book.language || '',
          extension: detectedFormat || '',
          status: 'failed',
          error: err.message,
          attempted_at: new Date().toISOString()
        }))

        // -- Webview reset after navigation failure --
        // Electron webview enters stuck state after 404/error pages.
        // Subsequent page.goto() calls hang until the state is cleared.
        // Navigating to about:blank forces a clean slate.
        await resetWebviewOrThrow(page, 'after error')

        results.push(toResultRow(book, 'failed', '', err.message))
        failed++
        continue
      }

      // -- 7b. Determine format -------------------------------------
      // Use auto-detected format from download link (primary) or
      // booklist metadata. The book.extension value comes from the
      // booklist API (external data) — validate it before use.
      let format = detectedFormat
      if (!format) {
        const rawExt = book.extension || 'epub'
        if (validateExtension(rawExt)) {
          format = String(rawExt).toLowerCase()
        } else {
          format = 'epub' // safe fallback if book.extension is invalid
        }
      }

      // -- 7c. Extract page metadata for filename template ------------
      // Uses the shared buildBookPageMetadata which calls all DOM extractors
      // in parallel and merges with fallback defaults (booklist API row / DOM card attrs).
      const metadata = await runWithTimeout(
        async () => buildBookPageMetadata(page, {
          title: book.title,
          author: book.author,
          language: book.language,
          extension: book.extension,
          formatQualityRating: book.formatQualityRating,
          qualityRating: book.qualityRating,
          publisher: book.publisher,
          isbn: book.isbn,
          md5: book.md5,
        }),
        timeoutMs,
        'buildBookPageMetadata for book ' + bookId
      )

      // -- 7c-2. Pass through caller's fallback MD5 (API book.md5) --
      // extractBookMd5 no longer reads from untrusted DOM sources
      // (propeller meta tag, /dl/<32hex>/ download URL), so it simply returns
      // the caller's fallbackMd5.
      if (validatedUrl) {
        const unifiedMd5 = await extractBookMd5(page, {
          downloadUrl: validatedUrl,
          fallbackMd5: book.md5,
        })
        if (unifiedMd5 && unifiedMd5 !== metadata.md5) {
          metadata.md5 = unifiedMd5
          console.warn('[booklist-download]', JSON.stringify({
            phase: 'md5_unified',
            bookId,
            source: metadata.md5 ? 'override' : 'fill',
            md5: unifiedMd5,
          }))
        }
      }

      // Method 1: Exact template filename match (--scan-existing, default true)
      // Pre-compute filename via renderFilenameTemplate with metadata.md5,
      // then check fs.existsSync at the exact path.
      let dedupSkipped = false
      if (scanExisting && metadata.md5) {
        const preFilename = renderFilenameTemplate(filenameTemplate, normalizeOutputKeys({
          ...metadata,
          id: String(bookId),
          bookId: String(bookId),
          md5: metadata.md5,
          extension: format,
          format: format,
          title: metadata.title || book.title || 'book',
          author: metadata.author || book.author || '',
        }))
        const prePath = path.resolve(outputDir, preFilename)
        const exists = existsSync(prePath)
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'md5_dedup_check',
          bookId,
          md5Present: !!metadata.md5,
          preFilename,
          exists,
        }))
        if (exists) {
          const preStat = statSync(prePath)
          saveCompletedManifestEntry(manifestPath, {
            book_id: bookId,
            title: metadata.title || book.title || '',
            author: metadata.author || book.author || '',
            language: metadata.language || book.language || '',
            extension: format,
            filename: preFilename,
            file_size: preStat.size,
            md5: metadata.md5,
          })
          existingCompletedBookIds.add(sanitiseBookId(bookId))
          results.push(toResultRow(book, 'downloaded', preFilename, ''))
          completed++
          dedupSkipped = true
          continue
        }
      }

      // Method 2: BookId-based directory scan (--scan-md5-suffix, default false)
      // Scan output directory for filenames containing _ID{bookId}_<32hex> pattern.
      // Compares the extracted MD5 against metadata.md5.
      // Validates candidate is a real file (isFile, non-zero size).
      // Sniffs first 4096 bytes to reject old HTML block pages.
      // Catches files from the new FILENAME_TEMPLATE_DEFAULT convention.
      if (!dedupSkipped && scanMd5Suffix && metadata.md5) {
        let foundFile = null
        try {
          const md5Lower = metadata.md5.toLowerCase()
          const entries = readdirSync(outputDir)
          const safeId = sanitiseBookId(bookId)
          const bookIdRegex = new RegExp(`_ID${safeId}_([a-f0-9]{32})`, 'i')
          for (const f of entries) {
            const fullPath = path.join(outputDir, f)
            try {
              if (!statSync(fullPath).isFile()) continue
            } catch (_) { continue }

            const m = f.match(bookIdRegex)
            if (!m) continue
            if (m[1].toLowerCase() !== md5Lower) continue

            const fstat = statSync(fullPath)
            if (fstat.size < MIN_DOWNLOAD_SIZE) {
              try { unlinkSync(fullPath) } catch (_) {}
              continue
            }

            // Sniff content — reject HTML block/download-limit pages
            try {
              const sample = readFirstBytes(fullPath, 4096)
              if (isLikelyHtmlPrefix(sample)) {
                try { unlinkSync(fullPath) } catch (_) {}
                continue
              }
            } catch (_) { continue }

            foundFile = f
            break
          }
        } catch (_) { /* directory not found or unreadable */ }

        if (foundFile) {
          const fullPath = path.join(outputDir, foundFile)
          const fstat = statSync(fullPath)
          saveCompletedManifestEntry(manifestPath, {
            book_id: bookId,
            title: metadata.title || book.title || '',
            author: metadata.author || book.author || '',
            language: metadata.language || book.language || '',
            extension: format,
            filename: foundFile, // use actual discovered filename
            file_size: fstat.size,
            md5: metadata.md5,
          })
          existingCompletedBookIds.add(sanitiseBookId(bookId))
          results.push(toResultRow(book, 'downloaded', foundFile, ''))
          completed++
          continue
        }
      }

      const md5DedupAttempted = scanExisting || scanMd5Suffix

      if (!metadata.md5) {
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'md5_dedup_unavailable',
          bookId,
          reason: 'missing_md5_after_bookid_scan',
          md5Present: false,
          continuesToDownload: true,
          scanExisting,
          scanMd5Suffix,
        }))
      } else if (md5DedupAttempted) {
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'md5_dedup_no_match',
          bookId,
          reason: 'no_existing_match',
          md5Present: true,
          continuesToDownload: true,
          scanExisting,
          scanMd5Suffix,
        }))
      } else {
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'md5_dedup_not_requested',
          bookId,
          reason: 'scan_disabled',
          md5Present: true,
          continuesToDownload: true,
          scanExisting,
          scanMd5Suffix,
        }))
      }

      // -- 7e. Retry loop — CDP Fetch download only -----------------
      let lastError = null
      let downloadAttempts = 0
      let downloadSucceeded = false

      // Per-book fixture recorder (only when --fixture flag is set)
      let fixtureRecorder = null
      try {
        if (fixtureFlag) {
          fixtureRecorder = new DownloadFixtureRecorder({
            enabled: true,
            command: 'booklist-download',
            bookId,
            outputDir,
          })
          const pageUrl = String(await page.evaluate('window.location.href').catch(() => '') || '')
          fixtureRecorder.recordBrowserContext({
            url: pageUrl,
            origin: siteOrigin,
            userAgent: String(await page.evaluate('navigator.userAgent').catch(() => '') || ''),
            language: String(await page.evaluate('navigator.language').catch(() => '') || ''),
          })

          // Record book metadata (title, author, extension) for fixture
          fixtureRecorder.recordBook({
            bookId,
            title: metadata.title || book.title || '',
            author: metadata.author || book.author || '',
            extension: format,
            sourceUrl: book.url || '',
          })

          // Record HTTP request details for fixture trigger block
          fixtureRecorder.recordRequest({
            method: 'GET',
            url: validatedUrl || '',
          })
        }
      } catch (_) { /* best-effort fixture init */ }

      // Initialize sub-phase timing breakdown for this download
      const dlTiming = {
        triggerClickMs: 0,
        requestSeenMs: 0,
        redirectMs: 0,
        streamMs: 0,
        writeMs: 0,
      }

      while (downloadAttempts < MAX_RETRIES && !downloadSucceeded && !quotaExceeded) {
        downloadAttempts++
        try {
          const downloadStartedAt = Date.now()

          // Build DownloadRequest for CDP Fetch transport pipeline.
          // urlRelative is the /dl/ path from extractNativeDownloadLink.
          // url_path: internal relative representation; url_full = siteOrigin + url_path.
          const bookPathname = book.url ? new URL(book.url).pathname : `/book/${bookId}`
          const request = {
            bookId,
            urlRelative: urlRelativeValue,
            origin: siteOrigin,
            referer: siteOrigin + bookPathname,
            format: format,
            outputDir,
            timeoutMs,
            metadata: {
              ...metadata,
              title: metadata.title || book.title || '',
              author: metadata.author || book.author || '',
              language: metadata.language || book.language || '',
              languageCode: metadata.languageCode || metadata.language || book.language || '',
              md5: metadata.md5 || book.md5 || '',
            },
            filenameTemplate,
            verifyDownload,
          }

          // Execute CDP Fetch download via reusable wrapper
          const dlResult = await initCdpDownload(page, request, {
            onCdpEvent: (evt) => {
              const evtTs = Date.now()
              // Track sub-timing from CDP events
              if (evt.event === 'dl_paused' && dlTiming.triggerClickMs === 0) {
                dlTiming.triggerClickMs = evtTs - downloadStartedAt
              } else if (evt.event === 'redirect_hop' && dlTiming.requestSeenMs === 0) {
                dlTiming.requestSeenMs = evtTs - downloadStartedAt
              } else if (evt.event === 'cdn_200' && dlTiming.redirectMs === 0) {
                dlTiming.redirectMs = evtTs - downloadStartedAt
              } else if (evt.event === 'stream_done' && dlTiming.streamMs === 0) {
                dlTiming.streamMs = evtTs - downloadStartedAt
              }
              if (fixtureRecorder) {
                fixtureRecorder.recordCdpNetwork(evt)
              }
            },
            verifyDownload,
          })
          // Compute CDN MD5 status for logging
          const cdnMd5 = dlResult.cdnMd5 || ''
          const artifactMd5 = dlResult.md5 || ''
          let cdnMd5Status = 'unavailable'
          if (cdnMd5) {
            cdnMd5Status = cdnMd5 === artifactMd5 ? 'matched' : 'mismatched'
          }
          cdnMd5Stats[cdnMd5Status]++
          phaseLog('download_book', downloadStartedAt, {
            bookId,
            filename: dlResult.filename,
            cdnMd5Status,
            cdnUrl: dlResult.cdnUrl || '',
            cdnMd5,
            artifactMd5,
            fileSize: dlResult.fileSize || 0,
            // Sub-phase timing breakdown (ms from download_started)
            triggerClickMs: dlTiming.triggerClickMs,
            requestSeenMs: dlTiming.requestSeenMs,
            redirectMs: dlTiming.redirectMs,
            streamMs: dlTiming.streamMs,
          })

          // Emit separate warning for CDN MD5 mismatch
          if (cdnMd5Status === 'mismatched') {
            console.warn('[booklist-download]', JSON.stringify({
              phase: 'cdn_md5_mismatch',
              bookId,
              cdnUrl: dlResult.cdnUrl || '',
              cdnMd5,
              artifactMd5,
            }))
            // Record mismatch as fixture error
            if (fixtureRecorder) {
              fixtureRecorder.recordError(
                new Error('CDN MD5 mismatch: artifact=' + artifactMd5 + ' cdn=' + cdnMd5),
                'validation'
              )
            }
          }

          // Record download result in fixture (when --fixture flag is set)
          // Map DownloadWorkflowResult fields to fixture schema.
          if (fixtureRecorder) {
            fixtureRecorder.recordDownloadResult({
              filename: dlResult.filename,
              finalPath: dlResult.outputPath,
              fileSizeBytes: dlResult.fileSize,
              md5: dlResult.md5,
              cdnMd5: dlResult.cdnMd5 || '',
              cdnMd5Verified: dlResult.cdnMd5Verified || false,
              cdnMd5Status,
            })
          }

          // Save completed entry to manifest via workflow helper
          recordCompletedDownload(dlResult, { manifestPath, outputDir }, {
            bookId,
            title: metadata.title || book.title || '',
            author: metadata.author || book.author || '',
            language: metadata.language || book.language || '',
          })

          // Track the new completed book_id so it isn't re-downloaded
          // in this batch run
          existingCompletedBookIds.add(sanitiseBookId(bookId))

          results.push(toResultRow(book, 'downloaded', dlResult.filename, ''))
          completed++
          downloadSucceeded = true
          consecutiveBlockPages = 0
          consecutiveGated204 = 0
          quotaTracker.consume(1)

          // Per-book completion lifecycle marker (end of navigate→extract→download→complete)
          console.warn('[booklist-download]', JSON.stringify({
            phase: 'complete',
            bookId,
            filename: dlResult.filename,
            fileSize: dlResult.fileSize || 0,
            cdnMd5Status,
            downloadAttempts,
          }))
        } catch (err) {
          lastError = err

          // Record error in fixture (when --fixture flag is set)
          if (fixtureRecorder) {
            fixtureRecorder.recordError(err, 'download')
          }

          // CDP infrastructure failure is fatal — abort immediately.
          // Save fixture before throwing — fixture save is after retry loop.
          if (isCdpDeathError(err)) {
            if (fixtureRecorder) {
              try { fixtureRecorder.save() } catch (_) { /* best-effort */ }
            }
            throw new CommandExecutionError('Fatal: CDP connection lost during download retry. ' + err.message)
          }

          // Debug log every download failure with context for offline diagnosis.
          // User has limited daily attempts — must fix without retrying.
          let pageUrl = ''
          try { pageUrl = String(await page.evaluate('window.location.href').catch(() => '')) } catch (_) {}
          console.warn('[booklist-download]', JSON.stringify({
            phase: 'download_attempt_failed',
            bookId,
            downloadAttempts,
            errorType: err instanceof CommandExecutionError ? 'CommandExecutionError' : (err instanceof Error ? err.constructor.name : typeof err),
            errorCode: err instanceof Error ? (err.code || '') : '',
            errorMsg: err instanceof Error ? err.message : String(err),
            pageUrl,
          }))

          // Check for batch-abort conditions:
          // - HTTP 204: server gate rejected request (rate-limit / anti-bot / invalid session)
          // - Quota exceeded (HTTP 403/429/402 or download-limit block page)
          // - Account banned (non-recoverable — no point retrying)
          if (err instanceof CommandExecutionError) {
            const msg = err.message || ''
            const statusCode = /** @type {number|undefined} */ (err.statusCode)
            const is204 = statusCode === 204 || msg.includes('HTTP 204')
            const isQuotaExceeded = msg.includes('HTTP 403') || msg.includes('HTTP 429') || msg.includes('HTTP 402') || msg.includes('Download quota exceeded') || msg.includes('quota is likely exhausted') || msg.startsWith('Download quota for')
            const isBanned = msg.startsWith('Download banned for')

            if (is204) {
              consecutiveGated204 = (consecutiveGated204 || 0) + 1
              console.warn('[booklist-download]', JSON.stringify({
                phase: 'download_gate_204_consecutive',
                bookId,
                pageUrl,
                statusCode: 204,
                downloadUrl: validatedUrl,
                message: msg,
                attempts: downloadAttempts,
                consecutiveGated204: consecutiveGated204,
              }))
              // Abort batch only on 3+ consecutive 204s (transient gate vs. persistent)
              if (consecutiveGated204 >= 3) {
                quotaExceeded = true
                break
              }
              // Otherwise: reset attempt loop, continue to next book
              break
            }

            if (isQuotaExceeded || isBanned) {
              const phase = isBanned ? 'banned_abort' : 'quota_exceeded_abort'
              console.warn('[booklist-download]', JSON.stringify({
                phase,
                bookId,
                pageUrl,
                message: msg,
                attempts: downloadAttempts,
              }))
              quotaExceeded = true
              break
            }
          }

          // Skip retry for stub/too_small errors — no point retrying, server is rate-limiting
          const stubPatterns = [
            'Downloaded EPUB is a stub',
            'Downloaded file too_small',
            'likely a stub',
          ]
          if (lastError && stubPatterns.some(p => lastError.message && lastError.message.includes(p))) {
            console.warn('[booklist-download]', JSON.stringify({
              phase: 'download_stub_skip_retry',
              bookId,
              downloadAttempts,
              maxRetries: MAX_RETRIES,
              errorMsg: lastError.message,
            }))
            // Skip remaining retries for this book
            downloadAttempts = MAX_RETRIES
            continue
          }

          // P1: Re-extract download link before retry (non-fatal errors only)
          // Server-side download gate may have specific token requirements;
          // reusing the same `/dl/<token>` on retry is unlikely to succeed.
          if (downloadAttempts < MAX_RETRIES && !quotaExceeded) {
            const oldUrl = validatedUrl
            try {
              // Resolve book URL against current site origin (supports cross-origin
              // imported booklists from old mirror exports).
              const retryNavUrl = book.url
                ? siteOrigin.replace(/\/$/, '') + new URL(book.url).pathname
                : siteOrigin + '/book/' + bookId
              await page.goto(retryNavUrl, { timeout: 15000 })
              const reExtractResult = await extractNativeDownloadLink(page, bookId, {
                timeoutMs,
                origin: siteOrigin,
                debug: false,
                targetUrl: book.url,
              })
              if (reExtractResult && reExtractResult.url) {
                const newValidated = validateDownloadUrl(reExtractResult.url, siteOrigin)
                if (newValidated) {
                  const oldToken = (oldUrl || '').split('/').pop()
                  const newToken = (newValidated || '').split('/').pop()
                  console.warn('[booklist-download]', JSON.stringify({
                    phase: 'download_retry_link_refresh',
                    bookId,
                    attempt: downloadAttempts,
                    oldToken: oldToken || '',
                    newToken: newToken || '',
                    linkChanged: oldToken !== newToken,
                  }))
                  validatedUrl = newValidated
                  urlRelativeValue = toDownloadUrlRelative(newValidated, siteOrigin)
                }
              }
            } catch (reExtractErr) {
              // Non-fatal: re-extraction failed, continue with old URL
              console.warn('[booklist-download]', JSON.stringify({
                phase: 'download_retry_link_refresh_failed',
                bookId,
                attempt: downloadAttempts,
                error: reExtractErr instanceof Error ? reExtractErr.message : String(reExtractErr),
              }))
            }

            // Brief pause before retry
            try { await page.wait({ time: 2 }) } catch (_) { /* best-effort */ }
          } else if (downloadAttempts < MAX_RETRIES) {
            // quota already exceeded — brief pause before fall-through
            try { await page.wait({ time: 2 }) } catch (_) { /* best-effort */ }
          }
        }
      }

      // -- Save fixture after download (success or failure) ---------
      if (fixtureRecorder) {
        try {
          const fixturePath = fixtureRecorder.save()
          if (fixturePath) {
            console.warn('[booklist-download]', JSON.stringify({
              phase: 'fixture_saved',
              bookId,
              path: fixturePath,
            }))
          }
        } catch (_) { /* best-effort */ }
      }

      // -- 7d. Handle final failure (after all retries) -------------
      if (!downloadSucceeded) {
        // Capture page URL at failure time — critical for diagnosing
        // download-link extraction failures without retrying.
        let failPageUrl = ''
        try { failPageUrl = String(await page.evaluate('window.location.href').catch(() => '')) } catch (_) {}

        // Detect consecutive HTML block pages (e.g. download-limit interstitial
        // that our HTML detection caught but didn't match quota/banned keywords).
        // After 2+ in a row, treat as quota exhaustion and abort the batch.
        if (lastError && (!quotaExceeded)) {
          const msg = lastError.message || ''
          if (msg.startsWith('Download returned an HTML page instead of a file')) {
            consecutiveBlockPages++
            console.warn('[booklist-download]', JSON.stringify({
              phase: 'html_block_detected',
              bookId,
              pageUrl: failPageUrl,
              consecutiveCount: consecutiveBlockPages,
            }))
            if (consecutiveBlockPages >= 2) {
              console.warn('[booklist-download]', JSON.stringify({
                phase: 'consecutive_html_block_abort',
                bookId,
                pageUrl: failPageUrl,
                consecutiveCount: consecutiveBlockPages,
              }))
              quotaExceeded = true
            }
          }
        }

        // Log final failure summary for offline diagnosis (10 attempts/day constraint)
        console.warn('[booklist-download]', JSON.stringify({
          phase: 'book_final_failure',
          bookId,
          errorType: lastError ? (lastError instanceof CommandExecutionError ? 'CommandExecutionError' : lastError.constructor.name) : 'Unknown',
          errorMsg: lastError ? lastError.message : 'Unknown error',
          pageUrl: failPageUrl,
          quotaExceeded,
          consecutiveBlockPages,
          downloadAttempts,
        }))

        // Append failed entry to manifest
        saveManifestEntry(manifestPath, makeManifestEntry({
          book_id: bookId,
          title: book.title || '',
          author: book.author || '',
          language: book.language || '',
          extension: format,
          status: 'failed',
          error: lastError ? lastError.message : 'Unknown error',
          attempted_at: new Date().toISOString()
        }))

        // The book that triggered quota shows the actual error;
        // subsequent books show 'quota_exceeded'
        let errorMsg = 'Unknown error'
        if (lastError?.errorType === 'download_engine_gated') {
          errorMsg = 'download_engine_gated'
        } else if (lastError) {
          errorMsg = lastError.message
        }
        results.push(toResultRow(book, 'failed', '', errorMsg))
        failed++
      }
    }

    // -- 7. Print summary to stderr -----------------------------------
    console.warn('[booklist-download]', JSON.stringify({
      phase: 'download_summary',
      total,
      completed,
      failed,
      skipped,
      details: {
        bookid_match: skippedByBookIdMatch,
        resume: skippedByResume,
        quota_exceeded: skippedByQuota,
        download_engine_gated: skippedByGated,
      },
      cdnMd5Stats,
    }))

    if (debugCdp) {
      await captureDebugSnapshot(page, debugPath, 'capture_end', {
        summary: { completed, failed, skipped, total },
      })
    }

    return results
  } finally {
    await lock.release()
  }
  }
})
