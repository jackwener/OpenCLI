/**
 * Download Rules Module  —  map anomaly codes to root causes and adapter hints.
 *
 * Pure classification. No I/O. One mapping table drives all root cause analysis.
 *
 * @module download-rules
 */

/**
 * @typedef {object} DownloadDoctorRootCause
 * @property {string} code - Anomaly code.
 * @property {'high'|'medium'|'low'} confidence - Classification confidence.
 * @property {string} summary - Root cause summary.
 * @property {string} zlibraryChangeHypothesis - Hypothesis about upstream change.
 * @property {Array<{ file: string, reason: string }>} adapterHints - Files to modify.
 */

// ---------------------------------------------------------------------------
// Root cause mapping table  —  single source of truth
// ---------------------------------------------------------------------------

/**
 * @type {Object<string, { confidence: string, summary: string, hypothesis: string, hints: Array<{ file: string, reason: string }> }>}
 */
var ROOT_CAUSE_MAP = {
  'NO_DL_REQUEST': {
    confidence: 'high',
    summary: 'No download request was initiated — the CDP Fetch event never fired',
    hypothesis: 'Z-Library changed the download initiation flow (link selector, button click, or JS event binding)',
    hints: [
      { file: '_shared/book-download/link.js', reason: 'Check link selector and download URL extraction' },
      { file: 'booklist-download.js', reason: 'Check download initiation logic and click sequence' },
    ],
  },
  'DL_STATUS_204': {
    confidence: 'high',
    summary: 'Download request returned HTTP 204 No Content — gate/block with no message body',
    hypothesis: 'Z-Library added or tightened a request gate (token expiry, session check, rate-limit pre-check)',
    hints: [
      { file: '_shared/book-download/transport.js', reason: 'Check request-stage header injection and token/session gate handling' },
    ],
  },
  'DL_STATUS_403': {
    confidence: 'high',
    summary: 'Download request returned HTTP 403 Forbidden — auth or quota rejection',
    hypothesis: 'Z-Library changed quota enforcement, auth token format, or session validation',
    hints: [
      { file: 'booklist-download.js', reason: 'Check quota/auth handling and session refresh logic' },
      { file: '_shared/quota/quota-checker.js', reason: 'Check quota state detection and refresh strategy' },
    ],
  },
  'DL_STATUS_429': {
    confidence: 'medium',
    summary: 'Download request returned HTTP 429 Too Many Requests — rate-limited',
    hypothesis: 'Z-Library introduced or tightened rate-limiting on download endpoints',
    hints: [
      { file: 'booklist-download.js', reason: 'Add rate-limit backoff or retry strategy' },
      { file: '_shared/book-download/transport.js', reason: 'Check rate-limit header parsing (Retry-After)' },
    ],
  },
  'NO_CDN_REDIRECT': {
    confidence: 'medium',
    summary: 'Request chain exists but final hop is not a CDN host — expected CDN redirect chain broken',
    hypothesis: 'Z-Library changed CDN provider or redirect logic (new intermediate hop or direct download)',
    hints: [
      { file: '_shared/book-download/transport.js', reason: 'Check redirect tracking and CDN URL pattern matching' },
    ],
  },
  'CDN_HTML_BLOCK': {
    confidence: 'high',
    summary: 'CDN returned HTML block page instead of file content — download limit or captcha wall',
    hypothesis: 'Z-Library added or modified block page (quota exceeded, suspicious activity, captcha challenge)',
    hints: [
      { file: '_shared/book-download/workflow.js', reason: 'Check block-page validation and quota detection logic' },
    ],
  },
  'MD5_MISMATCH': {
    confidence: 'high',
    summary: 'Downloaded file MD5 does not match CDN-provided MD5 — file corruption or wrong content',
    hypothesis: 'CDN served stale or corrupted content; or MD5 extraction from CDN URL changed format',
    hints: [
      { file: '_shared/book-download/contracts.js', reason: 'Check MD5 extraction and verification logic' },
      { file: '_shared/book-download/workflow.js', reason: 'Check MD5 comparison and error handling' },
    ],
  },
  'STREAM_ZERO_BYTES': {
    confidence: 'high',
    summary: 'CDN returned HTTP 200 but stream delivered zero bytes — I/O or stream handling failure',
    hypothesis: 'CDP transport stream handling changed (response body not read, connection dropped without error)',
    hints: [
      { file: '_shared/book-download/transport.js', reason: 'Check IO stream / Fetch stream handling and zero-byte detection' },
    ],
  },
  'CDN_NON_200': {
    confidence: 'medium',
    summary: 'CDN returned non-200 HTTP status — CDN-side error or redirect misconfiguration',
    hypothesis: 'CDN configuration changed (new error page, redirect loop, or upstream failure)',
    hints: [
      { file: '_shared/book-download/transport.js', reason: 'Check CDN response handling and status code validation' },
    ],
  },
  'FIXTURE_INSUFFICIENT': {
    confidence: 'medium',
    summary: 'Fixture schema-valid but lacks sufficient diagnostic data for root cause classification',
    hypothesis: 'Fixture recorder did not capture enough fields (response headers, error details, request chain)',
    hints: [
      { file: '_shared/book-download/fixture.js', reason: 'Extend fixture recorder to capture missing diagnostic fields' },
    ],
  },
}

/**
 * Map one anomaly to a root cause + adapter hints.
 *
 * @param {object} anomaly  -  DownloadDoctorAnomaly from diff module.
 * @returns {DownloadDoctorRootCause}
 */
export function classifyDownloadRootCause(anomaly) {
  var code = anomaly.code || 'UNKNOWN_DOWNLOAD_FAILURE'
  var mapping = ROOT_CAUSE_MAP[code]

  if (!mapping) {
    return {
      code: code,
      confidence: 'low',
      summary: 'Unknown download failure pattern: ' + code,
      zlibraryChangeHypothesis: 'Unrecognized failure mode — investigation required',
      adapterHints: [
        { file: 'doctor-download-v2.js', reason: 'Update doctor-download rules to handle new anomaly code: ' + code },
      ],
    }
  }

  return {
    code: code,
    confidence: /** @type {'high'|'medium'|'low'} */ (mapping.confidence),
    summary: mapping.summary,
    zlibraryChangeHypothesis: mapping.hypothesis,
    adapterHints: mapping.hints,
  }
}

/**
 * Map multiple anomalies to root causes, deduplicating by code.
 *
 * @param {object} opts
 * @param {Array<object>} opts.anomalies  -  Array of DownloadDoctorAnomaly.
 * @returns {{ rootCauses: DownloadDoctorRootCause[] }}
 */
export function classifyDownloadRootCauses({ anomalies }) {
  if (!anomalies || anomalies.length === 0) {
    return { rootCauses: [] }
  }

  var seen = {}
  var rootCauses = []

  for (var i = 0; i < anomalies.length; i++) {
    var code = anomalies[i].code
    if (seen[code]) continue
    seen[code] = true
    rootCauses.push(classifyDownloadRootCause(anomalies[i]))
  }

  return { rootCauses: rootCauses }
}
