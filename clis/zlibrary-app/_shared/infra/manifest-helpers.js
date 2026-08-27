/**
 * Manifest helpers and filename template rendering for zlibrary-app.
 *
 * Contains zlibrary-app-specific file-operation helpers extracted from
 * utils.js to clarify module dependencies. Functions here manage the
 * download manifest (JSONL) and filename template rendering.
 *
 * Imported by:
 *   - utils.js (re-exports for backward compat)
 *   - _shared/book-download/workflow.js (direct import)
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { isLikelyHtmlPrefix, MIN_DOWNLOAD_SIZE } from '../book-download/contracts.js'
import { formatMd5Tag } from './md5-format.js'

// ---------------------------------------------------------------------------
// Byte-Length Helpers (for filename template cut syntax)
// ---------------------------------------------------------------------------

/**
 * Return the UTF-8 byte length of a string.
 * @param {string} str
 * @returns {number}
 */
function getByteLength(str) {
  return new TextEncoder().encode(str).length
}

/**
 * Truncate a string so it contains at most `limit` UTF-8 bytes, not splitting
 * any Unicode code point mid-byte. If `includeEllipsis` is true, budget 3 bytes
 * for the ellipsis character. When the total limit is < 3 bytes and ellipsis
 * is requested, the placeholder is preserved literally (returns null) because
 * the ellipsis alone (3 bytes) cannot fit.
 *
 * @param {string} str — input string
 * @param {number} limit — max UTF-8 bytes
 * @param {boolean} includeEllipsis — whether to reserve 3 bytes for ellipsis
 * @returns {string|null} truncated+ellipsis string, or null to preserve literally
 */
function safeByteTruncate(str, limit, includeEllipsis) {
  if (includeEllipsis && limit < 3) {
    return null // ellipsis (3 bytes) doesn't fit
  }

  const totalBytes = getByteLength(str)
  if (totalBytes <= limit) {
    return str // no truncation needed, value fits within limit
  }

  const budget = includeEllipsis ? limit - 3 : limit
  if (budget <= 0) {
    return includeEllipsis ? '…' : ''
  }

  let bytes = 0
  const chars = [...str]
  const result = []
  for (const char of chars) {
    const charBytes = getByteLength(char)
    if (bytes + charBytes > budget) break
    bytes += charBytes
    result.push(char)
  }

  const truncated = result.join('')
  if (includeEllipsis) {
    return truncated + '…' // we already know truncation is needed (totalBytes > limit >= budget+3)
  }
  return truncated
}

// ---------------------------------------------------------------------------
// Filename Template Rendering
// ---------------------------------------------------------------------------

/**
 * Default filename template shared by download and booklist-download.
 * Keys: {title..80c}, {author..40c}, {language-code}, {format-quality-rating}, {id}, {md5}, {extension}
 */
export const FILENAME_TEMPLATE_DEFAULT = '{title..80c}_({author..40c})_({language-code})__Rank{format-quality-rating}_ID{id}_{md5}'

// Legacy backward-compatible renames for template placeholders.
// New kebab-case keys (e.g. {format-quality-rating}) resolve directly because
// values objects are normalized to kebab-case before rendering (see
// normalizeOutputKeys). Only keep aliases here that map legacy key names.
const TEMPLATE_ALIASES = {
  bookId: 'id',
  'book-id': 'id',
  isbn_number: 'isbn',
  'isbn-number': 'isbn'
}

/**
 * Safely look up a template key on a values object, avoiding prototype pollution.
 * @param {Record<string, unknown>} values
 * @param {string} key
 * @returns {unknown}
 */
function getTemplateValue(values, key) {
  const resolvedKey = TEMPLATE_ALIASES[key] || key
  if (!values) return null
  if (Object.prototype.hasOwnProperty.call(values, resolvedKey)) {
    return values[resolvedKey]
  }
  return null
}

/**
 * Parse a placeholder interior and return the resolved string value,
 * or the original placeholder preserved literally if unresolvable or malformed.
 * Supported forms: {key}, {key..Nc}, {key..Nu}, {key..Nc…}, {key..Nu…}
 * @param {string} inner
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
function parseTemplatePlaceholder(inner, values) {
  // Try cut with ellipsis: {key..N[u|c]…}
  const reEllipsis = /^([\w-]+)\.{2}([0-9]+)([cu])…$/
  const m1 = reEllipsis.exec(inner)
  if (m1) {
    const key = m1[1]
    const limit = parseInt(m1[2], 10)
    const unit = m1[3]
    if (limit <= 0) return '{' + inner + '}'
    if (unit === 'c' && limit < 3) return '{' + inner + '}'
    const value = getTemplateValue(values, key)
    if (value == null) return '{' + inner + '}'
    if (unit === 'c') {
      const r = safeByteTruncate(String(value), limit, true)
      return r || ''
    } else {
      const cps = [...String(value)]
      if (cps.length <= limit) return String(value)
      return cps.slice(0, limit - 1).join('') + '…'
    }
  }

  // Try cut without ellipsis: {key..N[u|c]}
  const reNoEllipsis = /^([\w-]+)\.{2}([0-9]+)([cu])$/
  const m2 = reNoEllipsis.exec(inner)
  if (m2) {
    const key = m2[1]
    const limit = parseInt(m2[2], 10)
    const unit = m2[3]
    if (limit <= 0) return '{' + inner + '}'
    const value = getTemplateValue(values, key)
    if (value == null) return '{' + inner + '}'
    if (unit === 'c') {
      const r = safeByteTruncate(String(value), limit, false)
      return r || ''
    } else {
      const cps = [...String(value)]
      return cps.slice(0, limit).join('')
    }
  }

  // Simple key: {key}
  if (/^[\w-]+$/.test(inner)) {
    const value = getTemplateValue(values, inner)
    if (value == null) return '{' + inner + '}'
    return String(value)
  }

  // Malformed placeholder: preserve literally
  return '{' + inner + '}'
}

/**
 * Render a filename template by replacing {key} placeholders with values.
 *
 * @example
 * renderFilenameTemplate('{author} - {title}', { author: 'Tolkien', title: 'LOTR' })
 * //=> 'Tolkien - LOTR'
 *
 * @param {string} template — e.g. "{author} - {title}"
 * @param {Record<string, string>} values — key -> value
 * @returns {string}
 */
export function renderFilenameTemplate(template, values) {
  let rendered = String(template).replace(/\{([^}]+)\}/g, function (_match, inner) {
    return parseTemplatePlaceholder(inner, values)
  })

  // Strip any remaining unresolvable {placeholder} patterns from the result
  rendered = rendered.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim()

  const ext = values?.extension
  if (ext && !/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(rendered)) {
    rendered += '.' + ext
  }

  return rendered
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^_|_+$/g, '')
    .slice(0, 255)
}

// ---------------------------------------------------------------------------
// Canonical key mapping for CLI output columns
// ---------------------------------------------------------------------------

/**
 * Canonical key mapping for CLI output columns.
 * Maps internal DOM field names (camelCase/underscore) to kebab-case column names.
 *
 * Internal layer keeps original keys (e.g., contentType).
 * The CLI output boundary converts them to kebab-case (e.g., content-type).
 * Only apply this at the final output boundary (func return).
 */
const OUTPUT_KEY_MAP = {
  contentType: 'content-type',
  qualityRating: 'quality-rating',
  formatQualityRating: 'format-quality-rating',
  languageCode: 'language-code',
  metaBooksTotal: 'meta-books-total',
  metaCreated: 'meta-created',
  detail_error: 'detail-error',
  metaDescription: 'meta-description',
  isbn10: 'isbn-10',
  isbn13: 'isbn-13'
}

/**
 * Normalize a row object's keys from internal camelCase/underscore to kebab-case.
 * Provides safe defaults for missing template values so filename rendering
 * does not produce literal `{language-code}` or `{format-quality-rating}`.
 *
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeOutputKeys(row) {
  const result = {}
  for (const [key, value] of Object.entries(row)) {
    result[OUTPUT_KEY_MAP[key] || key] = value
  }

  // Safe defaults for filename template keys.
  // renderFilenameTemplate strips remaining unresolvable {placeholders}
  // from the rendered output, so empty-string fallback is safe.
  if (!result['language-code'] && result.language) {
    result['language-code'] = result.language
  } else if (!result['language-code']) {
    result['language-code'] = ''
  }
  if (!result['format-quality-rating']) {
    result['format-quality-rating'] = 'NA'
  }

  return result
}

// ---------------------------------------------------------------------------
// Manifest / Resume Helpers
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ManifestEntry
 * @property {string} book_id
 * @property {string} title
 * @property {string} author
 * @property {string} language
 * @property {string} extension
 * @property {string} filename
 * @property {number|null} file_size
 * @property {string|null} md5
 * @property {ManifestStatus} status
 * @property {string|null} [error]
 * @property {string|null} [attempted_at]
 * @property {string|null} [completed_at]
 */

/**
 * @typedef {'pending'|'downloading'|'completed'|'failed'|'skipped'|'quota_exceeded'} ManifestStatus
 */

/**
 * @typedef {{ ok: boolean, reason?: string }} VerifyCompletedResult
 */

/**
 * Normalize author credit strings: canonicalize semicolon spacing.
 * Removes spaces before `;` and ensures one space after, so that
 * "小林弘幸 著 ; 許郁文 譯" and "小林弘幸 著;許郁文 譯" both become
 * "小林弘幸 著; 許郁文 譯".
 */
export function normalizeAuthorCredit(value) {
  return String(value || '').trim().replace(/\s*;\s*/g, '; ')
}

/**
 * Check whether a parsed JSON value is a valid manifest entry.
 * @param {unknown} value
 * @returns {value is ManifestEntry}
 */
function isManifestEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof value.book_id === 'string' && typeof value.status === 'string'
}

/**
 * Load a JSONL manifest file and return all entries.
 * @param {string} manifestPath — absolute or relative path to .jsonl file
 * @returns {ManifestEntry[]}
 */
export function loadManifest(manifestPath) {
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8')
    const entries = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (isManifestEntry(parsed)) {
          entries.push(parsed)
        }
      } catch {
        // skip malformed JSON lines
      }
    }
    return entries
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Append one entry (as a JSON line) to a JSONL manifest file.
 * Creates the file if it doesn't exist.
 * @param {string} manifestPath
 * @param {ManifestEntry} entry
 */
export function saveManifestEntry(manifestPath, entry) {
  const line = JSON.stringify(entry) + '\n'
  fs.appendFileSync(manifestPath, line, 'utf-8')
}

/**
 * Check whether an entry has been successfully completed.
 * @param {ManifestEntry} entry
 * @returns {boolean}
 */
export function isCompleted(entry) {
  return entry.status === 'completed'
}

/**
 * Filter out completed entries from a manifest array.
 * @param {ManifestEntry[]} entries
 * @returns {ManifestEntry[]}
 */
export function getPending(entries) {
  return entries.filter(e => !isCompleted(e))
}

/**
 * Compute MD5 hex digest of a file using streaming reads.
 * @param {string} filePath - Absolute path to file
 * @returns {Promise<string>} hex md5 digest
 * @throws {Error} if file not found or unreadable
 */
export async function computeFileMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => reject(err))
  })
}

/**
 * Return a human-readable summary of manifest statuses.
 * @param {ManifestEntry[]} entries
 * @returns {string}
 */
export function fmtStatusSummary(entries) {
  if (!entries.length) return 'No entries'

  const STATUS_ORDER = ['pending', 'downloading', 'completed', 'failed', 'skipped', 'quota_exceeded']

  const counts = {}
  for (const e of entries) {
    counts[e.status] = (counts[e.status] || 0) + 1
  }

  const parts = []
  const seen = new Set()
  for (const status of STATUS_ORDER) {
    if (counts[status] !== undefined) {
      parts.push(`${counts[status]} ${status}`)
      seen.add(status)
    }
  }
  // Append any unknown statuses at the end
  for (const [status, count] of Object.entries(counts)) {
    if (!seen.has(status)) {
      parts.push(`${count} ${status}`)
    }
  }

  const total = entries.length
  return `${parts.join(', ')}. Total: ${total}`
}

/**
 * Save a completed download entry to the manifest.
 * MD5 is optional metadata — entry is always written on successful download.
 *
 * @param {string} manifestPath
 * @param {object} entry - Partial ManifestEntry fields (book_id, title, author, etc.)
 * @param {string} entry.book_id
 * @param {string} [entry.title]
 * @param {string} [entry.author]
 * @param {string} [entry.language]
 * @param {string} [entry.extension]
 * @param {string} entry.filename
 * @param {number|null} entry.file_size
 * @param {string|null} [entry.md5]
 */
export function saveCompletedManifestEntry(manifestPath, entry) {
  saveManifestEntry(manifestPath, {
    book_id: entry.book_id || '',
    title: entry.title || '',
    author: entry.author || '',
    language: entry.language || '',
    extension: entry.extension || '',
    filename: entry.filename || '',
    file_size: entry.file_size !== undefined ? entry.file_size : null,
    md5: entry.md5 !== undefined ? entry.md5 : null,
    status: 'completed',
    error: null,
    attempted_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  })
}

// ---------------------------------------------------------------------------
// File verification and content sniffing (migrated from utils.js)
// ---------------------------------------------------------------------------

const MAX_RENAME_RETRIES = 3
const RENAME_RETRY_DELAYS = [100, 500, 1000]

/**
 * Rename a file with retry on EBUSY/EPERM errors.
 * These errors occur when the OS (e.g. macOS Spotlight, antivirus) temporarily
 * holds a file lock on the source path. The retry loop uses synchronous
 * blocking sleeps (Atomics.wait) between attempts.
 *
 * @param {string} src — Source path
 * @param {string} dest — Destination path
 * @throws {Error} Propagates non-retryable errors and the last EBUSY/EPERM error
 *   after all retries are exhausted.
 */
function renameWithRetry (src, dest) {
  for (let attempt = 0; attempt < MAX_RENAME_RETRIES; attempt++) {
    try {
      fs.renameSync(src, dest)
      return // success
    } catch (err) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < MAX_RENAME_RETRIES - 1) {
        const delay = RENAME_RETRY_DELAYS[attempt]
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
        continue
      }
      throw err // non-retryable or final attempt failed
    }
  }
}

/**
 * Read the first N bytes of a file into a Buffer.
 *
 * Exported for reuse by booklist-download.js for prededup/suffix scans.
 *
 * @param {string} filePath
 * @param {number} [numBytes=1024]
 * @returns {Buffer}
 */
export function readFirstBytes (filePath, numBytes = 1024) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(numBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, numBytes, 0)
    return bytesRead < numBytes ? buffer.subarray(0, bytesRead) : buffer
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Verify a completed manifest entry's file exists and (when applicable)
 * matches the stored md5 hash.
 *
 * @param {ManifestEntry} entry - Manifest entry (must have filename, md5)
 * @param {string} outputDir - Directory where files were downloaded
 * @param {object} [options]
 * @param {boolean} [options.checkMd5] - Verify MD5 hash when entry.md5 exists (default: false)
 * @returns {Promise<VerifyCompletedResult>}
 */
export async function verifyCompleted (entry, outputDir, options = {}) {
  if (!entry.filename || entry.status !== 'completed') {
    return { ok: false, reason: 'missing' }
  }

  const filePath = path.resolve(outputDir, entry.filename)
  const resolvedOutput = path.resolve(outputDir)
  if (!filePath.startsWith(resolvedOutput + path.sep) && filePath !== resolvedOutput) {
    return { ok: false, reason: 'path_escape' }
  }

  let stat
  try {
    stat = await fs.promises.stat(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, reason: 'not_found' }
    throw err
  }

  if (!stat.isFile()) {
    return { ok: false, reason: 'not_file' }
  }

  if (stat.size < MIN_DOWNLOAD_SIZE) {
    return { ok: false, reason: stat.size === 0 ? 'empty' : 'too_small' }
  }

  // HTML block page sniff — reject files that are actually HTML pages
  // (captcha, block page, login/download-limit wall returned instead of real file)
  try {
    const sample = readFirstBytes(filePath, 4096)
    if (isLikelyHtmlPrefix(sample)) {
      try { fs.unlinkSync(filePath) } catch (_) {}
      return { ok: false, reason: 'html_block' }
    }
  } catch (_) {
    return { ok: false, reason: 'read_error' }
  }

  if (options.checkMd5 && entry.md5) {
    const computed = await computeFileMd5(filePath)
    if (computed !== entry.md5) {
      return { ok: false, reason: 'md5_mismatch' }
    }
  }

  return { ok: true }
}

/**
 * Find a verified completed manifest entry by book_id.
 * Loads the manifest, finds the last completed entry matching book_id,
 * and verifies file existence + MD5 via verifyCompleted().
 *
 * @param {string} manifestPath
 * @param {string} outputDir
 * @param {string} bookId
 * @param {object} [options]
 * @param {boolean} [options.checkMd5]
 * @returns {Promise<ManifestEntry|null>}
 */
export async function findVerifiedCompletedByBookId (manifestPath, outputDir, bookId, options = {}) {
  const entries = loadManifest(manifestPath)
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'completed' && String(entries[i].book_id) === bookId) {
      const { ok } = await verifyCompleted(entries[i], outputDir, options)
      if (ok) return entries[i]
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Filename sanitisation helpers (migrated from utils.js)
// ---------------------------------------------------------------------------

/**
 * Sanitise a string for use as a safe filename segment.
 * Preserves all Unicode letters/numbers (including CJK, Cyrillic, Arabic, etc.)
 * plus underscore, hyphen, and space. Replaces dangerous filesystem characters
 * (/, \, :, *, ?, <, >, |, null bytes, control chars) with underscore.
 *
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function sanitiseFilename (input) {
  return String(input || 'book').replace(/[^\p{L}\p{N}_\- ]/gu, '_').trim() || 'book'
}

/**
 * Sanitise a book ID for use in filenames — removes characters that
 * could cause path traversal or filesystem issues.
 *
 * @param {string|number} bookId
 * @returns {string}
 */
export function sanitiseBookId (bookId) {
  return String(bookId).replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Format a download filename using the MD5 naming convention.
 *
 * Pattern: {BookID}_{Title}({Author})__MD5_{md5}__.{Extension}
 *
 * All dynamic segments are sanitised before assembly to prevent path
 * traversal. The md5 segment is the hex digest of the downloaded file.
 *
 * @param {string|number} bookId
 * @param {string} title
 * @param {string} author
 * @param {string} md5 - MD5 hex digest of the file content
 * @param {string} extension - File extension (without leading dot)
 * @returns {string}
 */
export function formatDownloadFilename (bookId, title, author, md5, extension) {
  const safeBookId = sanitiseBookId(bookId)
  const safeTitle = sanitiseFilename(title)
  const safeAuthor = author ? sanitiseFilename(author) : ''
  return safeBookId + '_' + safeTitle + '(' + safeAuthor + ')' +
    formatMd5Tag(md5) + '.' + String(extension).toLowerCase()
}

/**
 * Scan an output directory for any file that starts with a given BookID
 * prefix (plus underscore separator). Returns true if a match is found.
 *
 * Used for filesystem-based dedup: if a file named
 * `{safeBookId}_...__MD5_...__.{ext}` already exists in the output
 * directory, the download can be safely skipped.
 *
 * @param {string} outputDir - Directory to scan
 * @param {string|number} bookId - Book ID to search for
 * @returns {boolean}
 */
export function hasCanonicalDownloadForBookId (outputDir, bookId) {
  try {
    const safePrefix = sanitiseBookId(bookId) + '_'
    const entries = fs.readdirSync(outputDir)
    return entries.some(function (f) {
      return f.startsWith(safePrefix) && fs.statSync(path.join(outputDir, f)).isFile()
    })
  } catch {
    return false
  }
}
