// @ts-check
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { extractCdnMd5Tag } from '../infra/md5-format.js'
import { sanitizeDownloadTraceUrl } from '../infra/url-boundary.js'

/** Minimum valid download size — 4 KiB. Files below this are stubs. */
export const MIN_DOWNLOAD_SIZE = 4096

/**
 * Stub EPUB max byte threshold.
 * Real EPUB novels are >100 KB; 20 KB is a conservative ceiling.
 * Valid ZIP header with mimetype-only (no content docs) is typically <2 KB,
 * but cover-only stubs can reach ~15 KB. 20 KB safely catches both.
 */
const STUB_EPUB_MAX_BYTES = 20000

// Re-export for backward compatibility
export { sanitizeDownloadTraceUrl } from '../infra/url-boundary.js'

/**
 * Download contracts for zlibrary-app.
 *
 * Defines DownloadRequest, DownloadArtifact, and DownloadTraceV2 contracts
 * with validation functions used across download transports, artifact ingest,
 * and doctor commands.
 */

// ---------------------------------------------------------------------------
// Type definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DownloadRequest
 * @property {string} bookId
 * @property {string} urlRelative  -  relative path starting with /dl/
 * @property {string} origin  -  pure HTTPS origin for zlibrary-app (e.g. https://1lib.sk)
 * @property {string} referer  -  same-origin referer URL
 * @property {string} format  -  file extension (epub, pdf, etc.)
 * @property {string} outputDir  -  resolved output directory path
 * @property {string} [filenameTemplate]  -  optional filename template
 * @property {Record<string,string>} [metadata]
 * @property {number} [timeoutMs=300000]
 * @property {boolean} [verifyDownload=true]
 * @property {boolean} [fixture=false]
 * @property {'electron-cdp-fetch'} [transport='electron-cdp-fetch']
 */

/**
 * @typedef {Object} DownloadArtifact
 * @property {string} tempPath
 * @property {string} finalPath  -  empty until ingest completes
 * @property {string} md5  -  empty until content hash computed
 * @property {number} sizeBytes
 * @property {string} contentType
 * @property {{ transport: string, finalUrl: string, cdnMd5: string }} source
 */

/**
 * @typedef {Object} EventBus
 * @property {(event:string, handler:Function) => void} on
 * @property {(event:string, handler:Function) => void} off
 */

/**
 * @typedef {Object} DownloadTraceV2
 * @property {number} schemaVersion
 * @property {string} fixtureKind
 * @property {string} command
 * @property {string} capturedAt
 * @property {Object} book
 * @property {Object} browserContext
 * @property {Object} capability
 * @property {Object} trigger
 * @property {Array<Object>} requestChain
 * @property {{ name: string, streamBytes: number, chunks: number, suppressAction: string, browserDownloadEventSeen: boolean }} transport
 * @property {Object} artifact
 * @property {Object} validation
 * @property {Object|null} error
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Allowed download formats for zlibrary-app.
 *
 * Single source of truth imported by download-target.js and all consumers.
 * @type {string[]}
 */
export const DOWNLOAD_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'djvu', 'cbz', 'cbr', 'fb2', 'doc', 'docx', 'txt', 'rtf', 'zip', 'azw']

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a DownloadRequest.
 *
 * @param {DownloadRequest} request
 * @returns {{ valid: true }} | {{ valid: false, error: string }}
 */
export function validateDownloadRequest(request) {
  if (!request || typeof request !== 'object') {
    return { valid: false, error: 'DownloadRequest must be an object' }
  }

  if (!request.bookId || typeof request.bookId !== 'string') {
    return { valid: false, error: 'bookId must be a non-empty string' }
  }

  // origin  -  HTTPS only for zlibrary-app (R2)
  if (typeof request.origin !== 'string' || request.origin === '') {
    return { valid: false, error: 'origin must be a non-empty string' }
  }
  try {
    const u = new URL(request.origin)
    if (u.protocol !== 'https:') {
      return { valid: false, error: 'origin must be HTTPS for zlibrary-app' }
    }
    // Reject non-origin values (path/query/fragment)
    if (u.pathname !== '/' || u.search !== '' || u.hash !== '') {
      return { valid: false, error: 'origin must be a pure origin (no path/query/fragment)' }
    }
  } catch {
    return { valid: false, error: 'origin is not a valid URL' }
  }

  // urlRelative  -  structural URL parse (R1)
  if (typeof request.urlRelative !== 'string' || request.urlRelative === '') {
    return { valid: false, error: 'urlRelative must be a non-empty string' }
  }
  // Reject control characters
  if (/[\x00-\x1f\x7f]/.test(request.urlRelative)) {
    return { valid: false, error: 'urlRelative contains control characters' }
  }
  // Reject dot segments
  if (request.urlRelative.includes('/../') || request.urlRelative === '..' || request.urlRelative.startsWith('../')) {
    return { valid: false, error: 'urlRelative must not contain dot segments' }
  }
  // Structural parse  -  catches encoded host-shaped paths, etc.
  try {
    const resolved = new URL(request.urlRelative, request.origin)
    const originUrl = new URL(request.origin)
    if (resolved.origin !== originUrl.origin) {
      return { valid: false, error: 'urlRelative resolves to a different origin' }
    }
    if (!resolved.pathname.startsWith('/dl/')) {
      return { valid: false, error: 'urlRelative pathname must start with /dl/' }
    }
    if (request.urlRelative.includes('://')) {
      return { valid: false, error: 'urlRelative must not contain scheme or host' }
    }
  } catch {
    return { valid: false, error: 'urlRelative is not a valid URL' }
  }

  // referer must be same-origin with origin
  if (request.referer !== undefined && request.referer !== null && request.referer !== '') {
    try {
      const refUrl = new URL(request.referer)
      const originUrl = new URL(request.origin)
      if (refUrl.origin !== originUrl.origin) {
        return { valid: false, error: 'referer must be same-origin with origin' }
      }
    } catch {
      return { valid: false, error: 'referer is not a valid URL' }
    }
  }

  if (!request.outputDir || typeof request.outputDir !== 'string') {
    return { valid: false, error: 'outputDir must be a non-empty string' }
  }

  // format  -  non-empty, allowlisted extension (R4)
  if (typeof request.format !== 'string' || request.format === '') {
    return { valid: false, error: 'format must be a non-empty string' }
  }
  if (!DOWNLOAD_FORMATS.includes(request.format.toLowerCase())) {
    return { valid: false, error: `format '${request.format}' is not in the allowed extension list` }
  }

  if (request.filenameTemplate !== undefined && request.filenameTemplate !== null && typeof request.filenameTemplate !== 'string') {
    return { valid: false, error: 'filenameTemplate must be a string when provided' }
  }

  if (request.metadata !== undefined && request.metadata !== null) {
    if (typeof request.metadata !== 'object' || Array.isArray(request.metadata)) {
      return { valid: false, error: 'metadata must be a plain object when provided' }
    }
    for (const [key, value] of Object.entries(request.metadata)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return { valid: false, error: 'metadata values must be strings' }
      }
    }
  }

  if (request.verifyDownload !== undefined && request.verifyDownload !== null && typeof request.verifyDownload !== 'boolean') {
    return { valid: false, error: 'verifyDownload must be a boolean when provided' }
  }

  if (request.fixture !== undefined && request.fixture !== null && typeof request.fixture !== 'boolean') {
    return { valid: false, error: 'fixture must be a boolean when provided' }
  }

  if (request.timeoutMs !== undefined) {
    if (typeof request.timeoutMs !== 'number' || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      return { valid: false, error: 'timeoutMs must be a positive number' }
    }
  }

  // transport  -  zlibrary-app Electron contract only allows 'electron-cdp-fetch'
  if (request.transport !== undefined && request.transport !== null) {
    if (request.transport !== 'electron-cdp-fetch') {
      return { valid: false, error: 'transport must be "electron-cdp-fetch" for zlibrary-app' }
    }
  }

  return { valid: true }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a DownloadArtifact from a temp path and the original request.
 *
 * @param {string} tempPath  -  absolute path to the downloaded temp file
 * @param {DownloadRequest} request  -  the original download request
 * @returns {DownloadArtifact}
 */
export function buildDownloadArtifact(tempPath, request) {
  // Validate input request first (R5)
  const reqValidation = validateDownloadRequest(request)
  if (!reqValidation.valid) {
    throw new Error('Cannot build artifact from invalid request: ' + /** @type {any} */ (reqValidation).error)
  }
  // Reject non-electron-cdp-fetch transport (zlibrary-app contract)
  if (request.transport !== undefined && request.transport !== 'electron-cdp-fetch') {
    throw new Error('transport must be "electron-cdp-fetch" for zlibrary-app')
  }
  // Ensure tempPath is absolute
  if (typeof tempPath !== 'string' || !path.isAbsolute(tempPath)) {
    throw new Error('tempPath must be an absolute path')
  }
  // Ensure tempPath resolves inside outputDir (path containment via path.relative)
  const outDir = path.resolve(request.outputDir)
  const rel = path.relative(outDir, path.resolve(tempPath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tempPath must resolve inside outputDir')
  }
  return {
    tempPath: String(tempPath),
    finalPath: '',
    md5: '',
    sizeBytes: 0,
    contentType: '',
    source: {
      transport: 'electron-cdp-fetch',
      finalUrl: '',
      cdnMd5: '',
    },
  }
}

/**
 * Convert a value to a non-negative integer, or return fallback.
 * Rejects negative, NaN, Infinity, and non-integer values.
 *
 * @param {number|undefined} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function toNonNegativeInteger(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value)) {
    return value
  }
  return fallback
}

/**
 * Validate request chain  -  every hop must have HTTPS URL and valid redirect relationship.
 *
 * @param {Array<Object>} [chain]
 * @returns {Array<Object>}  -  sanitised request chain
 */
function validateRequestChain(chain) {
  if (!Array.isArray(chain)) return []
  return chain.map(hop => {
    const url = sanitizeDownloadTraceUrl(hop?.url || '')
    return {
      url: url,
      status: toNonNegativeInteger(hop?.status, 0),
      type: hop?.type || 'Navigation',
      timestamp: hop?.timestamp || new Date().toISOString(),
    }
  })
}

/**
 * Build a safe transport trace with validated counters.
 *
 * @param {Object|undefined} transport
 * @returns {{ name: string, streamBytes: number, chunks: number, suppressAction: string, browserDownloadEventSeen: boolean }}
 */
function buildTransportTrace(transport) {
  return {
    name: typeof transport?.name === 'string' ? transport.name : 'electron-cdp-fetch',
    streamBytes: toNonNegativeInteger(transport?.streamBytes, 0),
    chunks: toNonNegativeInteger(transport?.chunks, 0),
    suppressAction: typeof transport?.suppressAction === 'string' ? transport.suppressAction : '',
    browserDownloadEventSeen: typeof transport?.browserDownloadEventSeen === 'boolean' ? transport.browserDownloadEventSeen : false,
  }
}

function validateTransportSource(transport) {
  if (transport === undefined || transport === null) {
    return { valid: true }
  }

  if (!isPlainObject(transport)) {
    return { valid: false, error: 'transport must be a plain object when provided' }
  }

  if (transport.name !== undefined && transport.name !== 'electron-cdp-fetch') {
    return { valid: false, error: 'transport.name must be electron-cdp-fetch' }
  }

  if (transport.streamBytes !== undefined && (!Number.isInteger(transport.streamBytes) || transport.streamBytes < 0)) {
    return { valid: false, error: 'transport.streamBytes must be a non-negative integer' }
  }

  if (transport.chunks !== undefined && (!Number.isInteger(transport.chunks) || transport.chunks < 0)) {
    return { valid: false, error: 'transport.chunks must be a non-negative integer' }
  }

  if (transport.suppressAction !== undefined && transport.suppressAction !== '' && transport.suppressAction !== 'fulfill' && transport.suppressAction !== 'continue' && transport.suppressAction !== 'Aborted') {
    return { valid: false, error: 'transport.suppressAction must be fulfill, continue, Aborted, or empty string' }
  }

  if (transport.browserDownloadEventSeen !== undefined && typeof transport.browserDownloadEventSeen !== 'boolean') {
    return { valid: false, error: 'transport.browserDownloadEventSeen must be a boolean' }
  }

  return { valid: true }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRequestChainHop(hop, index) {
  if (!isPlainObject(hop)) {
    return { valid: false, error: `requestChain[${index}] must be a plain object` }
  }

  const rawUrl = typeof hop.url === 'string' ? hop.url : ''
  const sanitizedUrl = sanitizeDownloadTraceUrl(rawUrl)
  if (rawUrl === '' || sanitizedUrl === '') {
    return { valid: false, error: `requestChain[${index}].url must be HTTPS` }
  }

  if (!Number.isInteger(hop.status) || hop.status < 0) {
    return { valid: false, error: `requestChain[${index}].status must be a non-negative integer` }
  }

  if (hop.type !== undefined && hop.type !== 'Navigation' && hop.type !== 'Redirect' && hop.type !== 'Fetch') {
    return { valid: false, error: `requestChain[${index}].type must be Navigation, Redirect, or Fetch` }
  }

  if (hop.timestamp !== undefined && (typeof hop.timestamp !== 'string' || Number.isNaN(Date.parse(hop.timestamp)))) {
    return { valid: false, error: `requestChain[${index}].timestamp must be an ISO-8601 string` }
  }

  if (hop.redirectedFrom !== undefined && hop.redirectedFrom !== null && hop.redirectedFrom !== '') {
    if (sanitizeDownloadTraceUrl(hop.redirectedFrom) === '') {
      return { valid: false, error: `requestChain[${index}].redirectedFrom must be HTTPS` }
    }
  }

  if (hop.redirectedTo !== undefined && hop.redirectedTo !== null && hop.redirectedTo !== '') {
    if (sanitizeDownloadTraceUrl(hop.redirectedTo) === '') {
      return { valid: false, error: `requestChain[${index}].redirectedTo must be HTTPS` }
    }
  }

  return { valid: true }
}

function sanitizeRequestChainForTrace(chain) {
  if (!Array.isArray(chain)) return []

  return chain.map(hop => ({
    url: sanitizeDownloadTraceUrl(hop?.url || ''),
    status: Number.isInteger(hop?.status) && hop.status >= 0 ? hop.status : 0,
    redirectedFrom: hop?.redirectedFrom ? sanitizeDownloadTraceUrl(hop.redirectedFrom) : '',
    redirectedTo: hop?.redirectedTo ? sanitizeDownloadTraceUrl(hop.redirectedTo) : '',
    type: hop?.type === 'Redirect' || hop?.type === 'Fetch' ? hop.type : 'Navigation',
    timestamp: typeof hop?.timestamp === 'string' && hop.timestamp !== '' ? hop.timestamp : new Date().toISOString(),
  }))
}

function appendManifestEntry(manifestPath, entry) {
  const existingContent = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : ''
  const jsonLine = JSON.stringify(entry) + '\n'
  const tmpManifestPath = manifestPath + '.tmp'
  fs.writeFileSync(tmpManifestPath, existingContent + jsonLine, 'utf8')
  fs.renameSync(tmpManifestPath, manifestPath)
}

/**
 * Validate a DownloadTraceV2 record.
 *
 * @param {DownloadTraceV2} trace
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateDownloadTraceV2(trace) {
  if (!isPlainObject(trace)) {
    return { valid: false, error: 'DownloadTraceV2 must be a plain object' }
  }

  if (trace.schemaVersion !== 2) {
    return { valid: false, error: 'schemaVersion must be 2' }
  }

  if (trace.fixtureKind !== 'zlibrary-app.electron-cdp-download') {
    return { valid: false, error: 'fixtureKind must be zlibrary-app.electron-cdp-download' }
  }

  if (typeof trace.command !== 'string') {
    return { valid: false, error: 'command must be a string' }
  }

  if (typeof trace.capturedAt !== 'string' || Number.isNaN(Date.parse(trace.capturedAt))) {
    return { valid: false, error: 'capturedAt must be an ISO-8601 string' }
  }

  if (!isPlainObject(trace.book)) {
    return { valid: false, error: 'book must be a plain object' }
  }

  if (!isPlainObject(trace.browserContext)) {
    return { valid: false, error: 'browserContext must be a plain object' }
  }

  if (trace.browserContext.url !== undefined && trace.browserContext.url !== null && trace.browserContext.url !== '') {
    if (sanitizeDownloadTraceUrl(trace.browserContext.url) === '') {
      return { valid: false, error: 'browserContext.url must be HTTPS' }
    }
  }

  if (trace.browserContext.origin !== undefined && trace.browserContext.origin !== null && trace.browserContext.origin !== '') {
    if (sanitizeDownloadTraceUrl(trace.browserContext.origin) === '') {
      return { valid: false, error: 'browserContext.origin must be HTTPS' }
    }
  }

  if (!isPlainObject(trace.capability)) {
    return { valid: false, error: 'capability must be a plain object' }
  }

  if (!isPlainObject(trace.trigger)) {
    return { valid: false, error: 'trigger must be a plain object' }
  }

  if (!Array.isArray(trace.requestChain)) {
    return { valid: false, error: 'requestChain must be an array' }
  }
  for (let i = 0; i < trace.requestChain.length; i++) {
    const hopValidation = validateRequestChainHop(trace.requestChain[i], i)
    if (!hopValidation.valid) {
      return hopValidation
    }
  }

  for (let i = 0; i < trace.requestChain.length - 1; i++) {
    const currentHop = trace.requestChain[i]
    const nextHop = trace.requestChain[i + 1]
    if (currentHop.redirectedTo && currentHop.redirectedTo !== nextHop.url) {
      return { valid: false, error: `requestChain[${i}].redirectedTo must match requestChain[${i + 1}].url` }
    }
    if (nextHop.redirectedFrom && nextHop.redirectedFrom !== currentHop.url) {
      return { valid: false, error: `requestChain[${i + 1}].redirectedFrom must match requestChain[${i}].url` }
    }
  }

  if (!isPlainObject(trace.transport)) {
    return { valid: false, error: 'transport must be a plain object' }
  }

  if (trace.transport.name !== undefined && trace.transport.name !== 'electron-cdp-fetch') {
    return { valid: false, error: 'transport.name must be electron-cdp-fetch' }
  }
  if (!Number.isInteger(trace.transport.streamBytes) || trace.transport.streamBytes < 0) {
    return { valid: false, error: 'transport.streamBytes must be a non-negative integer' }
  }
  if (!Number.isInteger(trace.transport.chunks) || trace.transport.chunks < 0) {
    return { valid: false, error: 'transport.chunks must be a non-negative integer' }
  }
  if (trace.transport.suppressAction !== undefined && trace.transport.suppressAction !== '' && trace.transport.suppressAction !== 'fulfill' && trace.transport.suppressAction !== 'continue' && trace.transport.suppressAction !== 'Aborted') {
    return { valid: false, error: 'transport.suppressAction must be fulfill, continue, Aborted, or empty string' }
  }
  if (typeof trace.transport.browserDownloadEventSeen !== 'boolean') {
    return { valid: false, error: 'transport.browserDownloadEventSeen must be a boolean' }
  }

  if (!isPlainObject(trace.artifact)) {
    return { valid: false, error: 'artifact must be a plain object' }
  }
  if (trace.artifact.tempPath !== undefined && trace.artifact.tempPath !== null && trace.artifact.tempPath !== '' && typeof trace.artifact.tempPath !== 'string') {
    return { valid: false, error: 'artifact.tempPath must be a string' }
  }
  if (trace.artifact.fileSize !== undefined && (!Number.isInteger(trace.artifact.fileSize) || trace.artifact.fileSize < 0)) {
    return { valid: false, error: 'artifact.fileSize must be a non-negative integer' }
  }
  if (trace.artifact.md5 !== undefined && trace.artifact.md5 !== null && typeof trace.artifact.md5 !== 'string') {
    return { valid: false, error: 'artifact.md5 must be a string' }
  }

  if (!isPlainObject(trace.validation)) {
    return { valid: false, error: 'validation must be a plain object' }
  }

  // cdnMd5Status is optional: '' or one of the tri-state values
  if (trace.validation.cdnMd5Status !== undefined && trace.validation.cdnMd5Status !== '' && !['matched', 'unavailable', 'mismatched'].includes(trace.validation.cdnMd5Status)) {
    return { valid: false, error: 'validation.cdnMd5Status must be one of: matched, unavailable, mismatched, or empty string' }
  }

  if (trace.error !== null && trace.error !== undefined && typeof trace.error !== 'object') {
    return { valid: false, error: 'error must be an object or null' }
  }

  return { valid: true }
}

/**
 * Create a DownloadTraceV2 record from source data.
 * Fail-fast: sources must be a plain object.
 * RequestChain URLs are sanitized (/dl/<token> → /dl/...).
 * Counters use toNonNegativeInteger (no silent || coercion).
 *
 * @param {Object} sources
 * @returns {DownloadTraceV2}
 * @throws {Error} if sources is not a plain object
 */
export function createDownloadTraceV2(sources) {
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
    throw new Error('createDownloadTraceV2: sources must be a plain object')
  }

  const transportValidation = validateTransportSource(sources.transport)
  if (!transportValidation.valid) {
    throw new Error('Cannot build DownloadTraceV2: ' + transportValidation.error)
  }

  const trace = {
    schemaVersion: 2,
    fixtureKind: 'zlibrary-app.electron-cdp-download',
    command: typeof sources.command === 'string' ? sources.command : '',
    capturedAt: typeof sources.capturedAt === 'string' ? sources.capturedAt : new Date().toISOString(),
    book: typeof sources.book === 'object' && sources.book !== null ? sources.book : {},
    browserContext: typeof sources.browserContext === 'object' && sources.browserContext !== null ? sources.browserContext : {},
    capability: typeof sources.capability === 'object' && sources.capability !== null ? sources.capability : {},
    trigger: typeof sources.trigger === 'object' && sources.trigger !== null ? sources.trigger : {},
    requestChain: sanitizeRequestChainForTrace(sources.requestChain),
    transport: buildTransportTrace(sources.transport),
    artifact: typeof sources.artifact === 'object' && sources.artifact !== null ? sources.artifact : {},
    validation: typeof sources.validation === 'object' && sources.validation !== null ? sources.validation : {},
    error: sources.error || null,
  }

  const validation = validateDownloadTraceV2(trace)
  if (!validation.valid) {
    throw new Error('Cannot build DownloadTraceV2: ' + validation.error)
  }

  return trace
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Compute MD5 hex digest of a file using streaming reads (fallback).
 * Used when artifact.md5 is not pre-computed by the transport.
 *
 * @param {string} filePath  -  absolute file path
 * @returns {string}  -  32-char hex MD5 digest
 * @throws {Error}  -  if file not found or unreadable
 */
function computeStreamingMd5(filePath) {
  const hash = crypto.createHash('md5')
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(65536)
  try {
    let bytesRead = 0
    while ((bytesRead = fs.readSync(fd, buf, 0, 65536, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * Extract MD5 from a CDN download URL.
 *
 * Parses the `filename` query parameter from the CDN URL and extracts
 * the `__MD5_<32hex>__` tag from it.  Previously searched the entire
 * URL string, which could miss the pattern when the CDN URL path
 * contains hex-like segments.
 *
 * @param {string} finalUrl  -  absolute CDN URL
 * @returns {string}  -  32-char hex MD5, or '' if not found
 */
export function extractCdnMd5(finalUrl) {
  if (!finalUrl) return ''
  try {
    const parsed = new URL(finalUrl)
    // First try: CDN URL with filename query param (real production URL)
    const filenameParam = parsed.searchParams.get('filename')
    if (filenameParam) return extractCdnMd5Tag(filenameParam)
    // Second try: fallback to pathname (simplified test URLs, edge cases)
    return extractCdnMd5Tag(parsed.pathname)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Artifact Ingest
// ---------------------------------------------------------------------------

/**
 * Validate a DownloadArtifact against its DownloadRequest.
 *
 * @param {DownloadArtifact} artifact
 * @param {DownloadRequest} request
 * @param {Array<{url: string}>} [requestChain]  -  optional redirect chain
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateDownloadArtifact(artifact, request, requestChain) {
  // artifact must be a non-null object
  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, error: 'DownloadArtifact must be a non-null object' }
  }

  // tempPath must be non-empty string and absolute
  if (typeof artifact.tempPath !== 'string' || artifact.tempPath === '') {
    return { valid: false, error: 'artifact.tempPath must be a non-empty string' }
  }
  if (!path.isAbsolute(artifact.tempPath)) {
    return { valid: false, error: 'artifact.tempPath must be an absolute path' }
  }

  // tempPath must resolve inside outputDir
  const outDir = path.resolve(request.outputDir)
  const resolvedTemp = path.resolve(artifact.tempPath)
  const relative = path.relative(outDir, resolvedTemp)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { valid: false, error: 'artifact.tempPath must resolve inside outputDir' }
  }

  // source.finalUrl if non-empty MUST be https:
  if (artifact.source?.finalUrl !== undefined && artifact.source.finalUrl !== '' && artifact.source.finalUrl !== null) {
    try {
      const u = new URL(artifact.source.finalUrl)
      if (u.protocol !== 'https:') {
        return { valid: false, error: 'artifact.source.finalUrl must be HTTPS' }
      }
    } catch {
      return { valid: false, error: 'artifact.source.finalUrl is not a valid URL' }
    }
  }

  if (artifact.source?.transport !== undefined && artifact.source.transport !== 'electron-cdp-fetch') {
    return { valid: false, error: 'artifact.source.transport must be electron-cdp-fetch' }
  }

  // requestChain: every entry's url must be empty or https:
  if (requestChain !== undefined && Array.isArray(requestChain)) {
    for (let i = 0; i < requestChain.length; i++) {
      const entry = requestChain[i]
      if (entry && entry.url && typeof entry.url === 'string') {
        try {
          const u = new URL(entry.url)
          if (u.protocol !== 'https:') {
            return { valid: false, error: `requestChain[${i}].url must be HTTPS (got ${u.protocol})` }
          }
        } catch {
          return { valid: false, error: `requestChain[${i}].url is not a valid URL` }
        }
      }
    }
  }

  return { valid: true }
}

/**
 * Render a safe final filename from bookId, format, and optional template.
 * Default template: '{bookId}.{format}'
 *
 * @param {string} bookId
 * @param {string} format - validated extension (e.g., 'epub')
 * @param {string} [template]
 * @returns {string} - safe filename
 * @throws {Error} on path traversal or unsafe characters
 */
export function renderFinalFilename(bookId, format, template = '{bookId}.{format}') {
  if (typeof template !== 'string') {
    throw new Error('filenameTemplate must be a string')
  }
  const safe = template.replace(/\{bookId\}/g, bookId).replace(/\{format\}/g, format)

  // Reject path separators and dot segments
  if (safe.includes('/') || safe.includes('\\') || safe.includes('..')) {
    throw new Error('Rendered filename contains path separators: ' + safe)
  }

  // Reject unsafe characters
  if (/[<>:"|?*\x00-\x1f]/.test(safe)) {
    throw new Error('Rendered filename contains unsafe characters: ' + safe)
  }

  return safe
}

// ---------------------------------------------------------------------------
// Content sniffing helpers (buffer-based)
// ---------------------------------------------------------------------------

/**
 * Decode a byte buffer to string, handling UTF BOMs.
 * Internal helper for content sniffing.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decodeTextSample(buffer) {
  if (!buffer || buffer.length === 0) return ''
  // UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  // UTF-16 BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const src = buffer.subarray(2)
    const swapped = Buffer.alloc(src.length)
    for (let i = 0; i + 1 < src.length; i += 2) {
      swapped[i] = src[i + 1]
      swapped[i + 1] = src[i]
    }
    return swapped.toString('utf16le')
  }
  return buffer.toString('utf8')
}

/**
 * Robust HTML prefix detection that handles leading comments, XML PI, BOM, etc.
 * Internal helper for content sniffing.
 *
 * @param {Buffer} buffer - file content sample (at least 512 bytes recommended)
 * @returns {boolean}
 */
export function isLikelyHtmlPrefix(buffer) {
  if (!buffer || buffer.length === 0) return false
  const sample = decodeTextSample(buffer).slice(0, 8192)
  return /^(?:\uFEFF|\s|<!--[\s\S]*?-->|<\?xml[^>]*\?>)*<(?:!doctype\s+html\b|html\b|head\b|body\b|title\b|meta\b|link\b|script\b|style\b|div\b|span\b|p\b)/i.test(sample)
}

/**
 * Sniff MIME type from file magic bytes.
 * Internal helper for content sniffing.
 *
 * Checks known ebook formats first (PDF, EPUB, MOBI/AZW), then falls back to
 * HTML detection. Unknown content returns application/octet-stream.
 *
 * @param {Buffer} buffer - file content sample (at least 256 bytes recommended)
 * @returns {string} MIME type
 */
export function sniffMimeType(buffer) {
  if (!buffer || buffer.length === 0) return 'application/octet-stream'

  // PDF: starts with %PDF- (needs 4 bytes)
  if (buffer.length >= 4 &&
    buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf'
  }

  // EPUB/ZIP: PK at offset 0,1 (needs at least 2 bytes)
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    // Check for EPUB-specific mimetype entry (needs more bytes)
    if (buffer.length >= 4 && buffer[2] === 0x03 && buffer[3] === 0x04) {
      const head = buffer.toString('latin1', 0, Math.min(buffer.length, 256))
      if (head.includes('application/epub+zip')) return 'application/epub+zip'
      return 'application/zip'
    }
    // Short buffer with PK prefix  -  assume EPUB
    return 'application/epub+zip'
  }

  // MOBI/AZW: contains BOOKMOBI near start
  if (buffer.length >= 68) {
    const head = buffer.toString('latin1', 0, 68)
    if (head.includes('BOOKMOBI')) return 'application/x-mobipocket-ebook'
  }

  // DJVU: starts with AT&T (old) or FORM...DJVU (new)
  if (buffer.length >= 12) {
    const head = buffer.toString('latin1', 0, 12)
    if (head.startsWith('AT&T') || head.includes('DJVU')) return 'image/vnd.djvu'
  }

  // Check for HTML
  if (isLikelyHtmlPrefix(buffer)) return 'text/html'

  return 'application/octet-stream'
}

/**
 * Classify downloaded content by sniffing its magic bytes / HTML prefix.
 * Internal helper for content sniffing.
 *
 * Returns { html, mime } where:
 * - html: true if the content is HTML (block page, download-limit page, etc.)
 * - mime: detected MIME type from sniffMimeType
 *
 * This is NOT a format validator  -  it classifies what KIND of content was
 * actually downloaded, not whether it matches the expected format.
 *
 * @param {Buffer} buffer - file content sample
 * @returns {{ html: boolean, mime: string }}
 */
export function detectDownloadedContentKind(buffer) {
  const mime = sniffMimeType(buffer)
  return { html: mime === 'text/html', mime }
}

/**
 * Sniff content type from first bytes of a file.
 * Detects PDF, ZIP/EPUB, HTML block pages.
 *
 * @param {string} filePath
 * @returns {{ contentType: string, isBlockPage: boolean }}
 */
export function sniffContentType(filePath) {
  const sampleSize = 8192
  const buffer = Buffer.alloc(sampleSize)
  const fd = fs.openSync(filePath, 'r')
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(fd, buffer, 0, sampleSize, 0)
  } finally {
    fs.closeSync(fd)
  }
  const { html, mime } = detectDownloadedContentKind(buffer.subarray(0, bytesRead))
  return { contentType: mime === 'application/octet-stream' ? '' : mime, isBlockPage: html }
}

/**
 * Ingest a downloaded temp file into a final named artifact.
 * Steps: validate -> stat -> sniff -> MD5 -> verify -> rename -> manifest.
 * Does NOT consume quota  -  caller must consume after { status: 'completed' }.
 *
 * @param {DownloadArtifact} artifact  -  from buildDownloadArtifact()
 * @param {DownloadRequest} request  -  validated download request
 * @param {{ verifyMd5?: boolean, rejectBlockPage?: boolean }} [policy]
 * @returns {{ status: string, finalPath?: string, md5?: string, sizeBytes?: number, contentType?: string, source?: object, reason?: string, errorHtmlPath?: string }}
 * @throws {Error} on validation failure, path traversal, zero-byte, I/O error
 */
export function ingestDownloadArtifact(artifact, request, policy = {}) {
  // Step 0: Validate inputs
  const artifactValidation = validateDownloadArtifact(artifact, request)
  if (!artifactValidation.valid) {
    throw new Error('Cannot ingest invalid artifact: ' + artifactValidation.error)
  }

  // Step 0b: Path containment check
  const outDir = path.resolve(request.outputDir)
  const tempPath = path.resolve(artifact.tempPath)
  const rel = path.relative(outDir, tempPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tempPath must resolve inside outputDir')
  }

  // Step 1: Stat file — consolidated min-size check (0 < MIN_DOWNLOAD_SIZE)
  const stat = fs.statSync(tempPath)
  if (stat.size < MIN_DOWNLOAD_SIZE) {
    const reason = stat.size === 0 ? 'empty' : 'too_small'
    try { fs.unlinkSync(tempPath) } catch { /* best-effort */ }
    throw new Error('Downloaded file ' + reason + ' (' + stat.size + ' bytes, minimum ' + MIN_DOWNLOAD_SIZE + '): likely a stub')
  }

  // Step 2: Sniff MIME type
  const { contentType, isBlockPage } = sniffContentType(tempPath)

  // Step 3: Block page handling
  if (isBlockPage && policy.rejectBlockPage !== false) {
    // Use renderFinalFilename to reject path traversal in bookId (R14)
    const errorName = renderFinalFilename(request.bookId, 'html', '{bookId}_error.html')
    const errorPath = path.join(outDir, errorName)
    // Path containment check (path.relative to prevent sibling-dir escape)
    const relError = path.relative(outDir, errorPath)
    if (relError.startsWith('..') || path.isAbsolute(relError)) {
      throw new Error('Block page error path escapes output dir: ' + errorPath)
    }
    try {
      fs.renameSync(tempPath, errorPath)
    } catch {
      // If rename fails, temp file remains  -  caller can clean up
      throw new Error('Block page detected but rename to error file at ' + errorPath)
    }
    // Append rejected manifest entry (Rule R12: rejected MUST be recorded)
    const manifestPath = path.join(outDir, '.manifest.jsonl')
    appendManifestEntry(manifestPath, {
      status: 'rejected',
      reason: 'block_page',
      errorHtmlPath: errorPath,
      bookId: request.bookId,
      format: request.format,
    })
    return {
      status: 'rejected',
      reason: 'block_page',
      errorHtmlPath: errorPath,
    }
  }

  // Step 3b: Stub EPUB detection
  // Z-Library CDN may return valid-ZIP but stub EPUBs (~858B-1.2K) under
  // rate-limiting — proper ZIP header with mimetype but no content docs.
  // Detect by: EPUB MIME + abnormally small size (< 20KB).
  if (contentType === 'application/epub+zip' && stat.size < STUB_EPUB_MAX_BYTES) {
    try { fs.unlinkSync(tempPath) } catch { /* best-effort */ }
    throw new Error('Downloaded EPUB is a stub (' + stat.size + ' bytes): valid ZIP header with mimetype only')
  }

  // Step 4: Compute MD5 — trust transport-computed hash (SSOT)
  // CDP transport computes MD5 incrementally in IO.read loop; artifact.md5
  // always has a value from transport. Fallback to streaming compute for
  // non-CDP transports that may return artifact.md5 as empty.
  const computedMd5 = artifact.md5 || computeStreamingMd5(tempPath)

  // Step 5: CDN MD5 verification — Z-Library CDN only returns file MD5,
  // mismatch means file is corrupt or wrong content was served.
  // Per user decision: hard reject, not warning.
  if (policy.verifyMd5 && artifact.source?.cdnMd5) {
    if (computedMd5 !== artifact.source.cdnMd5) {
      try { fs.unlinkSync(tempPath) } catch { /* best-effort */ }
      throw new Error('CDN MD5 mismatch: file is corrupt or wrong')
    }
  }

  // Step 6: Render final filename
  const finalName = renderFinalFilename(request.bookId, request.format, request.filenameTemplate)

  // Step 7: Atomic rename
  const finalPath = path.join(outDir, finalName)
  fs.renameSync(tempPath, finalPath)

  // Step 8: Append to manifest (direct append  -  atomic on same-filesystem)
  const manifestPath = path.join(outDir, '.manifest.jsonl')
  const manifestEntry = {
    finalPath,
    bookId: request.bookId,
    format: request.format,
    md5: computedMd5,
    sizeBytes: stat.size,
    contentType,
    transport: artifact.source?.transport || 'electron-cdp-fetch',
    cdnMd5: artifact.source?.cdnMd5 || '',
  }
  appendManifestEntry(manifestPath, manifestEntry)

  return {
    status: 'completed',
    finalPath,
    md5: computedMd5,
    sizeBytes: stat.size,
    contentType,
    source: artifact.source,
  }
}

// ---------------------------------------------------------------------------
// HTML block page detection (migrated from utils.js)
// ---------------------------------------------------------------------------

/**
 * Detect and classify an HTML block/download-limit page from a file sample.
 *
 * Uses keyword matching AND structural signals (CSS class names, JS redirect
 * patterns, title patterns, size clusters) for robust classification.
 *
 * Callers should first check `isLikelyHtmlPrefix(buffer)` before calling this;
 * this function uses `isLikelyHtmlPrefix` internally as well so it works standalone.
 *
 * @param {Buffer|string} sample - File content buffer (preferred) or string
 * @param {object} [opts]
 * @param {number} [opts.fileSize] - Full file size (for size-cluster scoring)
 * @returns {{ html: boolean, title: string, keywords: string[], type: string, signals: string[], confidence: string }}
 */
export function detectHtmlBlockContent (sample, opts = {}) {
  const { fileSize } = opts
  const result = { html: false, title: '', keywords: [], type: 'unknown', signals: [], confidence: 'low' }

  // Convert buffer to string if needed
  let headerStr
  if (Buffer.isBuffer(sample)) {
    headerStr = decodeTextSample(sample)
  } else if (typeof sample === 'string') {
    headerStr = sample
  } else {
    return result
  }

  // Use isLikelyHtmlPrefix for robust HTML detection (handles comments, XML PI, BOM)
  if (!headerStr || !isLikelyHtmlPrefix(Buffer.from(headerStr, 'utf8'))) {
    return result
  }
  result.html = true

  // Extract <title> tag content
  const titleMatch = headerStr.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch) {
    result.title = titleMatch[1].trim()
  }

  // Normalize for keyword matching
  const lower = headerStr.toLowerCase()

  // Z-Library quota/limit + banned phrases
  const phrases = [
    // Chinese quota/limit
    { kw: '今日下载', type: 'quota', match: '今日下载' },
    { kw: '下载次数已达上限', type: 'quota', match: '下载次数已达上限' },
    { kw: '下载限制', type: 'quota', match: '下载限制' },
    { kw: '每日限制', type: 'quota', match: '每日限制' },
    { kw: '登录', type: 'login', match: '登录' },
    { kw: '封禁', type: 'banned', match: '封禁' },
    { kw: '滥用', type: 'banned', match: '滥用' },
    { kw: '账户被禁用', type: 'banned', match: '账户被禁用' },
    { kw: '过多连接', type: 'banned', match: '过多连接' },
    { kw: 'アカウント停止', type: 'banned', match: 'アカウント停止' },

    // English quota/limit
    { kw: 'daily limit', type: 'quota', match: 'daily.limit' },
    { kw: 'download quota', type: 'quota', match: 'download.quota' },
    { kw: 'daily download limit', type: 'quota', match: 'daily.download.limit' },
    { kw: 'too many downloads', type: 'quota', match: 'too.many.downloads' },
    { kw: 'rate limit', type: 'quota', match: 'rate.limit' },
    { kw: 'sign in', type: 'login', match: 'sign.in' },
    { kw: 'log in', type: 'login', match: 'log.in' },
    { kw: 'login', type: 'login', match: 'login' },
    { kw: 'suspicious activity', type: 'blocked', match: 'suspicious' },
    { kw: 'blocked', type: 'blocked', match: 'blocked' },
    { kw: 'captcha', type: 'blocked', match: 'captcha' },
    { kw: 'cloudflare', type: 'blocked', match: 'cloudflare' },
    { kw: 'access denied', type: 'blocked', match: 'access.denied' },
    { kw: 'forbidden', type: 'blocked', match: 'forbidden' },
    { kw: 'please wait', type: 'blocked', match: 'please.wait' },

    // Account ban / suspension (non-recoverable — no point retrying)
    { kw: 'banned', type: 'banned', match: 'banned' },
    { kw: 'account suspended', type: 'banned', match: 'account.suspended' },
    { kw: 'account disabled', type: 'banned', match: 'account.disabled' },
    { kw: 'too many connections', type: 'banned', match: 'too.many.connections' },
    { kw: 'abuse', type: 'banned', match: 'abuse' },
    { kw: 'terminated', type: 'banned', match: 'terminated' },
  ]

  for (const p of phrases) {
    if (lower.includes(p.match.replace(/\./g, ' '))) {
      result.keywords.push(p.kw)
      // First match wins for type, more specific types override
      if (result.type === 'unknown' || p.type === 'quota') {
        result.type = p.type
      }
    }
  }

  // -- Structural signals (NEW) --

  // 1. CSS class: download-limits-error → download limit page
  if (lower.includes('download-limits-error') || lower.includes('download_limits_error')) {
    result.signals.push('download-limits-css')
    if (result.type === 'unknown') result.type = 'quota'
  }

  // 2. "File Conversion limitations" link → download limit page
  if (lower.includes('file conversion limitations')) {
    result.signals.push('file-conversion-limits')
    if (result.type === 'unknown') result.type = 'quota'
  }

  // 3. Title starts with "Downloading" → download-limit interstitial
  if (/^downloading\s/i.test(result.title)) {
    result.signals.push('downloading-interstitial-title')
    if (result.type === 'unknown') result.type = 'quota'
  }

  // 4. JS redirect (Downloading interstitial that expects browser)
  if (lower.includes('window.location') && (lower.includes('settimeout') || lower.includes('setinterval'))) {
    result.signals.push('js-redirect-interstitial')
    if (result.type === 'unknown') result.type = 'quota'
  }

  // 5. Title is empty → suspicious signal (alone is too weak to classify as banned)
  if (!result.title) {
    result.signals.push('empty-title')
  }

  // 6. Size cluster: 50-90KB is typical Z-Library block page
  if (fileSize && fileSize > 50000 && fileSize < 90000) {
    result.signals.push('size-cluster-50-90kb')
  }

  // Body text snippet
  const bodyMatch = headerStr.match(/<body[^>]*>[\s\n]*([^<>\n]{10,200})/i)
  if (bodyMatch) {
    const snippet = bodyMatch[1].replace(/\s+/g, ' ').trim()
    if (snippet) result.keywords.push('snippet:' + snippet.substring(0, 120))
  }

  // -- Set confidence --
  if (result.keywords.length >= 2 || (result.keywords.length >= 1 && result.signals.length >= 1)) {
    result.confidence = 'high'
  } else if (result.keywords.length >= 1 || result.signals.length >= 1) {
    result.confidence = 'medium'
  }

  return result
}
