/**
 * Download Baseline Module  —  derive expected success pattern from
 * successful fixture signatures.
 *
 * If >=1 success fixture exists, derive majority baseline.
 * If no success fixture, baseline is unavailable — never fabricate defaults.
 * Never stores exact CDN URL or token as baseline.
 *
 * @module download-baseline
 */

/**
 * @typedef {object} DownloadDoctorBaseline
 * @property {boolean} available - Whether a baseline could be derived.
 * @property {'high'|'medium'|'low'} confidence - Confidence level.
 * @property {'derived-from-success-fixtures'|'no-success-fixture'} source - Baseline source.
 * @property {object|null} expected - Expected values for comparison (null when unavailable).
 * @property {string} expected.chainPattern - Expected chain pattern.
 * @property {string} expected.finalHostClass - Expected final host class.
 * @property {number} expected.finalStatus - Expected final HTTP status.
 * @property {number} expected.minArtifactBytes - Minimum expected artifact size.
 * @property {boolean} expected.streamMatchesArtifact - Whether stream should match artifact.
 * @property {boolean} expected.htmlDetected - Whether HTML should be detected.
 * @property {string} expected.suppressAction - Expected suppress action.
 * @property {string[]} sampleFiles - Example fixture filenames.
 * @property {string[]} warnings - Baseline derivation warnings.
 */

// ---------------------------------------------------------------------------
// No-baseline sentinel  —  never fabricate expected values
// ---------------------------------------------------------------------------

/** @type {DownloadDoctorBaseline} */
var NO_BASELINE = {
  available: false,
  confidence: 'low',
  source: 'no-success-fixture',
  expected: null,
  sampleFiles: [],
  warnings: ['No success fixtures available — baseline not derived'],
}

/**
 * Derive a download baseline from a list of signatures.
 *
 * @param {object} opts
 * @param {Array<object>} opts.signatures  -  Array of DownloadDoctorSignature objects.
 * @returns {DownloadDoctorBaseline}
 */
export function deriveDownloadBaseline({ signatures }) {
  if (!signatures || signatures.length === 0) {
    return NO_BASELINE
  }

  var successSignatures = signatures.filter(function (s) { return s.outcome === 'success' })
  if (successSignatures.length === 0) {
    return NO_BASELINE
  }

  return deriveFromSuccessFixtures(successSignatures)
}

/**
 * Derive baseline from successful fixture signatures.
 *
 * @param {Array<object>} successSignatures  -  Success-outcome signatures.
 * @returns {DownloadDoctorBaseline}
 */
function deriveFromSuccessFixtures(successSignatures) {
  var n = successSignatures.length
  var warnings = []

  // Majority vote helper
  function majority(items, extract) {
    var counts = {}
    for (var i = 0; i < items.length; i++) {
      var val = extract(items[i])
      counts[val] = (counts[val] || 0) + 1
    }
    var best = ''
    var bestCount = 0
    for (var k in counts) {
      if (counts[k] > bestCount) {
        bestCount = counts[k]
        best = k
      }
    }
    return { value: best, count: bestCount, total: items.length }
  }

  // Chain pattern
  var chainResult = majority(successSignatures, function (s) { return s.chainPattern })
  // Final host class
  var hostResult = majority(successSignatures, function (s) { return s.finalHostClass })
  // Final status — majority, fallback 200
  var statusResult = majority(successSignatures, function (s) { return String(s.finalStatus ?? '') })
  var finalStatus = parseInt(statusResult.value, 10) || 200

  // Min artifact bytes: lower bound from success fixtures
  var minBytes = Infinity
  for (var i = 0; i < successSignatures.length; i++) {
    if (successSignatures[i].artifactSize > 0 && successSignatures[i].artifactSize < minBytes) {
      minBytes = successSignatures[i].artifactSize
    }
  }
  if (!isFinite(minBytes)) {
    minBytes = 4096
    warnings.push('No positive artifact sizes in success fixtures — using 4096 fallback')
  }

  // Stream matches artifact: majority or true
  var streamMatch = true
  var mismatchCount = 0
  for (var j = 0; j < successSignatures.length; j++) {
    var s2 = successSignatures[j]
    if (s2.streamBytes !== s2.artifactSize) mismatchCount++
  }
  if (mismatchCount > n / 2) streamMatch = false

  // Suppress action majority
  var suppressResult = majority(successSignatures, function (s) { return s.suppressAction || '' })
  var suppressAction = suppressResult.value || 'fulfill'

  // Confidence: derived from success fixtures
  var confidence = n >= 3 ? 'high' : (n >= 1 ? 'medium' : 'low')

  var expected = {
    chainPattern: chainResult.value || '',
    finalHostClass: hostResult.value || '',
    finalStatus: finalStatus,
    minArtifactBytes: minBytes,
    streamMatchesArtifact: streamMatch,
    htmlDetected: false,
    suppressAction: suppressAction,
  }

  return {
    available: true,
    confidence: confidence,
    source: 'derived-from-success-fixtures',
    expected: expected,
    sampleFiles: successSignatures.map(function (s) { return s.file }),
    warnings: warnings,
  }
}
