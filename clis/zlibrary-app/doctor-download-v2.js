/**
 * Z-Library App doctor --download mode.
 *
 * CDP-only fixture doctor. Reads local download fixture JSON files from
 * `download --fixture` / `booklist-download --fixture` output.
 *
 * Thin orchestration only — delegates to 6 modular diagnostics in
 * _shared/snapshot/download-*.js.
 *
 * Pure local fixture reader: no network, no browser navigation, no replay,
 * no cookie extraction, no file download.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { loadDownloadFixtureSet } from './_shared/fixture/loader.js'
import { toDownloadSignature } from './_shared/snapshot/download-signature.js'
import { deriveDownloadBaseline } from './_shared/snapshot/download-baseline.js'
import { diffDownloadAgainstBaseline } from './_shared/snapshot/download-diff.js'
import { classifyDownloadRootCauses } from './_shared/snapshot/download-rules.js'
import { buildDoctorDownloadReport } from './_shared/snapshot/download-report.js'

// ---------------------------------------------------------------------------
// Backward-compat exports — preserved for any external consumers
// ---------------------------------------------------------------------------

/**
 * Check whether the fixture recorded a successful download.
 * Primary signal: artifact.fileSize > 0.
 * Secondary: artifact.md5 is a 32-char hex string.
 *
 * @param {object} trace  -  parsed fixture (DownloadTraceV2)
 * @returns {boolean}
 */
export function hasDownloadArtifact(trace) {
  if (!trace.artifact || typeof trace.artifact !== 'object') return false
  if (typeof trace.artifact.fileSize === 'number' && trace.artifact.fileSize > 0) {
    return true
  }
  if (typeof trace.artifact.md5 === 'string' && trace.artifact.md5.length === 32) {
    return true
  }
  return false
}

/**
 * Build a request-chain summary from the fixture's requestChain array.
 *
 * @param {object} trace  -  parsed fixture (DownloadTraceV2)
 * @returns {string}
 */
export function networkResponseSummary(trace) {
  var chain = Array.isArray(trace.requestChain) ? trace.requestChain : []
  var firstStatus = chain.length > 0 ? chain[0].status || '?' : '?'
  if (chain.length === 0) return 'empty'
  return chain.length + ' hops, first_status:' + firstStatus
}

/**
 * Safely extract error message from fixture error object.
 * Only extracts safe summary fields — never dumps raw headers/URLs/session data.
 *
 * @param {object} trace  -  parsed fixture
 * @returns {string}  -  empty string if no error, else summary
 */
export function fixtureErrorMessage(trace) {
  if (!trace.error || typeof trace.error !== 'object') return ''
  var parts = []
  if (typeof trace.error.message === 'string' && trace.error.message) {
    var msg = trace.error.message.length > 200
      ? trace.error.message.substring(0, 200) + '...'
      : trace.error.message
    parts.push(msg)
  }
  if (typeof trace.error.phase === 'string' && trace.error.phase) {
    parts.push('[' + trace.error.phase + ']')
  }
  if (typeof trace.error.type === 'string' && trace.error.type) {
    parts.push('(' + trace.error.type + ')')
  }
  return parts.join(' ') || 'error recorded'
}

// ---------------------------------------------------------------------------
// Main entry — exported for doctor.js --download dispatch
// ---------------------------------------------------------------------------

/**
 * Run doctor-download diagnostic on a fixture directory.
 *
 * Pipeline:
 *   1. loadDownloadFixtureSet  —  scan + validate files
 *   2. toDownloadSignature     —  normalize signatures
 *   3. deriveDownloadBaseline  —  derive expected pattern
 *   4. diffDownloadAgainstBaseline  —  detect anomalies
 *   5. classifyDownloadRootCauses  —  map to root causes + hints
 *   6. buildDoctorDownloadReport   —  produce rows + JSON report
 *
 * @param {object} kwargs
 * @param {string} kwargs.dir  -  Directory with CDP download fixture JSON files
 * @returns {Promise<Array<object>>}  -  Array of doctorRow objects
 */
export async function runDoctorDownload(kwargs) {
  // Step 1: Intake
  var fixtureSet = loadDownloadFixtureSet({
    dir: String(kwargs['dir'] || '').trim(),
    filePattern: '.fixture.json',
  })

  // Step 2: Signatures
  var signatures = fixtureSet.valid.map(function (entry) {
    return toDownloadSignature({ file: entry.file, trace: entry.trace })
  })

  // Step 3: Baseline
  var baseline = deriveDownloadBaseline({ signatures: signatures })

  // Step 4: Diff
  var diffResult = diffDownloadAgainstBaseline({ baseline: baseline, signatures: signatures })

  // Step 5: Root causes
  var rootCauseResult = classifyDownloadRootCauses({ anomalies: diffResult.anomalies })

  // Step 6: Report
  var reportResult = buildDoctorDownloadReport({
    fixtureSet: fixtureSet,
    signatures: signatures,
    baseline: baseline,
    diffResult: diffResult,
    rootCauseResult: rootCauseResult,
  })

  return reportResult.rows
}
