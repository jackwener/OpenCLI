/**
 * Download Signature Module  —  convert raw DownloadTraceV2 into stable
 * diagnostic signature for cross-fixture comparison.
 *
 * Hides internal DownloadTraceV2 shape. Outputs a flat, comparable object
 * with no raw URL tokens, cookie values, or session data.
 *
 * @module download-signature
 */

/**
 * @typedef {object} DownloadDoctorSignature
 * @property {string} file - Basename of fixture file.
 * @property {string} bookId - Book identifier.
 * @property {string} command - Command that produced the fixture.
 * @property {'success'|'failure'} outcome - Classified outcome.
 * @property {string} originHost - Origin hostname (no protocol).
 * @property {string} chainPattern - Structured pattern like "302:Fetch:same-origin -> 200:Fetch:file-cdn".
 * @property {number[]} hopStatuses - Status codes per hop.
 * @property {string[]} hopTypes - Resource types per hop.
 * @property {'same-origin'|'file-cdn'|'other'|'none'} finalHostClass - Final request host classification.
 * @property {number|null} finalStatus - Final hop HTTP status.
 * @property {number} artifactSize - Downloaded file size in bytes.
 * @property {number} streamBytes - Transport stream bytes.
 * @property {number} chunks - Number of transport chunks.
 * @property {string} suppressAction - CDP suppress action.
 * @property {'matched'|'mismatched'|'unavailable'} md5Status - MD5 verification status.
 * @property {boolean} htmlDetected - Whether HTML block page was detected.
 * @property {string} errorPhase - Phase where error occurred.
 * @property {string} errorType - Type of error.
 * @property {string} errorMessageClass - Classified error message (safe, no tokens/cookies).
 * @property {string[]} evidence - List of evidence strings for diagnosis.
 */

/**
 * Classify a hostname into a host class for drift-resistant comparison.
 * Exported for use by baseline module.
 *
 * @param {string} hostname  -  e.g. "cdn.z-lib.gl"
 * @returns {'same-origin'|'file-cdn'|'other'|'none'}
 */
export function classifyFinalHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return 'none'
  var lower = hostname.toLowerCase()
  // CDN patterns: cdn.*, *cdn*, *-cdn-*, cloudfront, cloudflare
  if (lower.includes('cdn') || lower.includes('cloudfront') || lower.includes('cloudflare')) {
    return 'file-cdn'
  }
  return 'other'
}

/**
 * Classify a single hop's host class against the page origin.
 *
 * @param {string|null|undefined} hopUrl  -  Hop request URL
 * @param {string} originHost  -  Page origin hostname
 * @returns {'same-origin'|'file-cdn'|'other'}
 */
function classifyHopHost(hopUrl, originHost) {
  if (!hopUrl || !originHost) return 'other'
  try {
    var hostname = new URL(hopUrl).hostname
    if (hostname === originHost) return 'same-origin'
    if (hostname.includes('cdn') || hostname.includes('cloudfront') || hostname.includes('cloudflare')) return 'file-cdn'
    return 'other'
  } catch (_) { return 'other' }
}

/**
 * Derive a safe error message string without exposing tokens, cookies, or URLs.
 *
 * @param {object|null} err  -  trace.error object.
 * @returns {{ phase: string, type: string, msgClass: string }}
 */
function safeErrorSummary(err) {
  if (!err || typeof err !== 'object') {
    return { phase: '', type: '', msgClass: '' }
  }
  var phase = typeof err.phase === 'string' ? err.phase : ''
  var type = typeof err.type === 'string' ? err.type : ''
  var statusCode = typeof err.statusCode === 'number' ? err.statusCode : 0
  // Build safe message class: status code + type only, no URL/header/details
  var parts = []
  if (phase) parts.push('phase:' + phase)
  if (type) parts.push('type:' + type)
  if (statusCode > 0) parts.push('http:' + statusCode)
  return {
    phase: phase,
    type: type,
    msgClass: parts.join(' ') || 'unknown',
  }
}

/**
 * Convert a single DownloadTraceV2 fixture into a normalized diagnostic signature.
 *
 * @param {object} params
 * @param {string} params.file  -  Fixture basename.
 * @param {object} params.trace  -  Parsed DownloadTraceV2 trace.
 * @returns {DownloadDoctorSignature}
 */
export function toDownloadSignature({ file, trace }) {
  // --- Safe string / number extraction ---
  var bookId = (trace.book && trace.book.bookId) || ''
  var command = (trace.command) || ''
  var originHost = ''
  if (trace.browserContext && trace.browserContext.origin) {
    try {
      originHost = new URL(trace.browserContext.origin).hostname
    } catch (_) { /* ignore */ }
  }

  // --- Request chain analysis ---
  var chain = trace.requestChain || []
  var chainPattern = chain.map(function (h) {
    var hopClass = classifyHopHost(h.url, originHost)
    return (h.status || '?') + ':' + (h.type || '?') + ':' + hopClass
  }).join(' -> ') || '(empty)'
  var hopStatuses = chain.map(function (h) { return h.status || 0 })
  var hopTypes = chain.map(function (h) { return h.type || '' })

  var finalHop = chain.length > 0 ? chain[chain.length - 1] : null
  var finalStatus = finalHop ? (finalHop.status || null) : null
  var finalHostname = ''
  if (finalHop && finalHop.url) {
    try {
      finalHostname = new URL(finalHop.url).hostname
    } catch (_) { /* ignore */ }
  }
  var finalHostClass = classifyFinalHost(finalHostname)

  // --- Artifact ---
  var art = trace.artifact || {}
  var artifactSize = (typeof art.fileSize === 'number' && art.fileSize >= 0) ? art.fileSize : 0

  // --- Transport ---
  var trans = trace.transport || {}
  var streamBytes = (typeof trans.streamBytes === 'number' && trans.streamBytes >= 0) ? trans.streamBytes : 0
  var chunks = (typeof trans.chunks === 'number' && trans.chunks >= 0) ? trans.chunks : 0
  var suppressAction = trans.suppressAction || ''

  // --- Validation ---
  var val = trace.validation || {}
  var md5Status = val.cdnMd5Status || 'unavailable'
  if (md5Status !== 'matched' && md5Status !== 'mismatched') md5Status = 'unavailable'
  var htmlDetected = Boolean(val.htmlDetected)

  // --- Error ---
  var errSummary = safeErrorSummary(trace.error)

  // --- Outcome classification ---
  var outcome = classifyOutcome({
    artifactSize: artifactSize,
    artifactMd5: art.md5,
    md5Status: md5Status,
    htmlDetected: htmlDetected,
    streamBytes: streamBytes,
    finalStatus: finalStatus,
    error: trace.error,
    chainPattern: chainPattern,
  })

  // --- Evidence ---
  var evidence = []
  if (chain.length === 0) evidence.push('no-request-chain')
  if (finalStatus === null) evidence.push('no-final-status')
  if (artifactSize === 0 && streamBytes === 0) evidence.push('zero-bytes')
  if (htmlDetected) evidence.push('html-block-page')
  if (md5Status === 'mismatched') evidence.push('md5-mismatch')
  if (trace.error) evidence.push('has-error:' + errSummary.msgClass)
  if (suppressAction === 'Aborted') evidence.push('request-aborted')

  return {
    file: file || '',
    bookId: bookId,
    command: command,
    outcome: outcome,
    originHost: originHost,
    chainPattern: chainPattern,
    hopStatuses: hopStatuses,
    hopTypes: hopTypes,
    finalHostClass: finalHostClass,
    finalStatus: finalStatus,
    artifactSize: artifactSize,
    streamBytes: streamBytes,
    chunks: chunks,
    suppressAction: suppressAction,
    md5Status: md5Status,
    htmlDetected: htmlDetected,
    errorPhase: errSummary.phase,
    errorType: errSummary.type,
    errorMessageClass: errSummary.msgClass,
    evidence: evidence,
  }
}

/**
 * Classify outcome from trace fields.
 * Exported for testing.
 *
 * @param {object} fields
 * @returns {'success'|'failure'}
 */
export function classifyOutcome(fields) {
  var hasError = fields.error && typeof fields.error === 'object'
  var noArtifact = fields.artifactSize === 0
  var noStream = fields.streamBytes === 0

  // Success: file has content or valid MD5, no blocking error
  var hasContent = fields.artifactSize > 4096 || (fields.artifactSize > 0 && fields.artifactMd5)

  if (fields.htmlDetected) return 'failure'
  if (hasError && noArtifact && noStream) return 'failure'
  if (fields.md5Status === 'mismatched') return 'failure'
  if (fields.finalStatus !== null && fields.finalStatus >= 400) return 'failure'
  if (fields.finalStatus === 204) return 'failure'
  if (hasContent && !hasError) return 'success'

  // Ambiguous: fall to failure
  return 'failure'
}
