/**
 * Download Diff Module  —  compare signatures against baseline and emit
 * anomaly facts.
 *
 * Pure functions. No I/O. Produces typed anomaly records for the rules engine.
 * Anomaly precedence: gate status > CDN response > HTML block > MD5 mismatch >
 * zero stream > redirect shape > insufficient. First match wins.
 *
 * @module download-diff
 */

/**
 * @typedef {object} DownloadDoctorAnomaly
 * @property {string} file - Fixture file name.
 * @property {string} bookId - Book identifier.
 * @property {string} code - Anomaly code (e.g. 'NO_DL_REQUEST', 'DL_STATUS_403').
 * @property {'P1'|'P2'|'P3'} severity - Anomaly severity.
 * @property {string} expected - Expected value.
 * @property {string} actual - Actual value.
 * @property {string[]} evidence - Evidence strings.
 */

/**
 * Compare a list of signatures against a baseline and produce anomaly facts.
 *
 * @param {object} opts
 * @param {object} opts.baseline  -  DownloadDoctorBaseline from deriveDownloadBaseline().
 * @param {Array<object>} opts.signatures  -  Array of DownloadDoctorSignature objects.
 * @returns {{ anomalies: DownloadDoctorAnomaly[] }}
 */
export function diffDownloadAgainstBaseline({ baseline, signatures }) {
  var anomalies = []

  if (!signatures || signatures.length === 0) {
    return { anomalies: [] }
  }

  for (var i = 0; i < signatures.length; i++) {
    var sig = signatures[i]

    if (sig.outcome === 'success') {
      var successAnomalies = checkSuccessAgainstBaseline(sig, baseline)
      anomalies = anomalies.concat(successAnomalies)
      continue
    }

    // Failure signatures — highest-precedence anomaly wins
    var failureAnomaly = classifyFailureAnomaly(sig, baseline)
    if (failureAnomaly) {
      anomalies.push(failureAnomaly)
    }
  }

  return { anomalies: anomalies }
}

/**
 * Check even success signatures for baseline deviations.
 *
 * @param {object} sig  -  DownloadDoctorSignature
 * @param {object} baseline  -  DownloadDoctorBaseline
 * @returns {DownloadDoctorAnomaly[]}
 */
function checkSuccessAgainstBaseline(sig, baseline) {
  var result = []

  if (sig.hopStatuses.length === 0) {
    result.push(buildAnomaly(sig, 'NO_DL_REQUEST', 'P2',
      'request chain exists', 'no request chain',
      ['no-request-chain']))
  }

  // NO_CDN_REDIRECT (now "NO_FILE_CDN"): even success sigs should reach file-cdn
  if (sig.hopStatuses.length > 0 && sig.finalHostClass !== 'file-cdn' && sig.finalHostClass !== 'none') {
    result.push(buildAnomaly(sig, 'NO_CDN_REDIRECT', 'P2',
      'final host class: file-cdn',
      'final host class: ' + sig.finalHostClass,
      (sig.evidence || []).concat(['no-cdn-redirect'])))
  }

  return result
}

/**
 * Classify a failure signature into exactly one anomaly code.
 * Precedence order (highest first):
 *   1. NO_DL_REQUEST (no chain)
 *   2. DL_STATUS_204/403/429 (gate status)
 *   3. CDN_NON_200 (CDN non-200 response)
 *   4. CDN_HTML_BLOCK (HTML block)
 *   5. MD5_MISMATCH
 *   6. STREAM_ZERO_BYTES
 *   7. NO_CDN_REDIRECT
 *   8. FIXTURE_INSUFFICIENT
 *
 * @param {object} sig
 * @param {object} baseline
 * @returns {DownloadDoctorAnomaly|null}
 */
function classifyFailureAnomaly(sig, baseline) {
  var evidence = sig.evidence || []

  // 1. NO_DL_REQUEST: no request chain at all
  if (sig.hopStatuses.length === 0) {
    return buildAnomaly(sig, 'NO_DL_REQUEST', 'P1',
      'request chain present', 'empty request chain', evidence)
  }

  // 2. Gate status codes (highest precedence)
  if (sig.hopStatuses.some(function (s) { return s === 204 })) {
    return buildAnomaly(sig, 'DL_STATUS_204', 'P1',
      'expected non-204 status', 'HTTP 204 No Content',
      evidence.concat(['status-204']))
  }

  if (sig.hopStatuses.some(function (s) { return s === 403 })) {
    return buildAnomaly(sig, 'DL_STATUS_403', 'P1',
      'expected non-403 status', 'HTTP 403 Forbidden',
      evidence.concat(['status-403']))
  }

  if (sig.hopStatuses.some(function (s) { return s === 429 })) {
    return buildAnomaly(sig, 'DL_STATUS_429', 'P1',
      'expected non-429 status', 'HTTP 429 Too Many Requests',
      evidence.concat(['status-429']))
  }

  // 3. CDN_NON_200: CDN was final host but status is not 200
  if (sig.finalHostClass === 'file-cdn' && sig.finalStatus !== null && sig.finalStatus !== 200) {
    return buildAnomaly(sig, 'CDN_NON_200', 'P2',
      'expected HTTP 200 from CDN', 'HTTP ' + sig.finalStatus + ' from CDN',
      evidence.concat(['cdn-non-200']))
  }

  // 4. CDN_HTML_BLOCK: HTML detected
  if (sig.htmlDetected) {
    return buildAnomaly(sig, 'CDN_HTML_BLOCK', 'P1',
      'non-HTML content expected', 'HTML block page detected',
      evidence.concat(['html-block']))
  }

  // 5. MD5_MISMATCH
  if (sig.md5Status === 'mismatched') {
    return buildAnomaly(sig, 'MD5_MISMATCH', 'P1',
      'MD5 matched', 'MD5 mismatch',
      evidence.concat(['md5-mismatch']))
  }

  // 6. STREAM_ZERO_BYTES: CDN returned 200 but stream was empty
  if (sig.streamBytes === 0 && sig.artifactSize === 0 && sig.finalStatus === 200) {
    return buildAnomaly(sig, 'STREAM_ZERO_BYTES', 'P1',
      'stream bytes > 0', 'zero stream bytes despite HTTP 200',
      evidence.concat(['zero-stream']))
  }

  // 7. NO_CDN_REDIRECT: chain exists but final host is not file-cdn
  if (sig.hopStatuses.length > 0 && sig.finalHostClass !== 'file-cdn' && sig.finalHostClass !== 'none') {
    return buildAnomaly(sig, 'NO_CDN_REDIRECT', 'P2',
      'final host class: file-cdn',
      'final host class: ' + sig.finalHostClass,
      evidence.concat(['no-cdn-redirect']))
  }

  // 8. FIXTURE_INSUFFICIENT: schema-valid but no useful diagnostic data
  if (evidence.length <= 1 && sig.hopStatuses.length <= 1 && sig.artifactSize === 0 && !sig.errorType) {
    return buildAnomaly(sig, 'FIXTURE_INSUFFICIENT', 'P2',
      'has diagnostic data', 'insufficient signal for classification',
      ['no-error', 'no-chain', 'no-artifact'])
  }

  // No specific anomaly matches — emit nothing (ambiguous failure)
  return null
}

/**
 * Build a typed anomaly record.
 *
 * @param {object} sig
 * @param {string} code
 * @param {'P1'|'P2'|'P3'} severity
 * @param {string} expected
 * @param {string} actual
 * @param {string[]} evidence
 * @returns {DownloadDoctorAnomaly}
 */
function buildAnomaly(sig, code, severity, expected, actual, evidence) {
  return {
    file: sig.file || '',
    bookId: sig.bookId || '',
    code: code,
    severity: severity,
    expected: expected,
    actual: actual,
    evidence: evidence || [],
  }
}
