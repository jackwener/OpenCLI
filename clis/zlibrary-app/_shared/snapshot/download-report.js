/**
 * Download Report Module  —  produce machine-readable JSON + doctor output rows.
 *
 * Aggregates: fixture set stats, baseline, anomalies, root causes, adapter hints.
 * Output fits the existing 5-column doctor row contract.
 *
 * Security: never includes raw cookie values, session tokens, or raw /dl/<token> URLs.
 * JSON report is always valid JSON — never truncated.
 *
 * @module download-report
 */

import path from 'node:path'
import { doctorRow } from './rows.js'

/**
 * Build the complete doctor --download report.
 *
 * @param {object} opts
 * @param {object} opts.fixtureSet  -  Result from loadDownloadFixtureSet().
 * @param {Array<object>} opts.signatures  -  Array of DownloadDoctorSignature.
 * @param {object} opts.baseline  -  DownloadDoctorBaseline from deriveDownloadBaseline().
 * @param {object} opts.diffResult  -  Result from diffDownloadAgainstBaseline().
 * @param {object} opts.rootCauseResult  -  Result from classifyDownloadRootCauses().
 * @returns {{ rows: Array<{probe:string,status:string,count:string,sampleValue:string,message:string}>, report: object }}
 */
export function buildDoctorDownloadReport({ fixtureSet, signatures, baseline, diffResult, rootCauseResult }) {
  var rows = []
  var anomalies = (diffResult && diffResult.anomalies) || []
  var rootCauses = (rootCauseResult && rootCauseResult.rootCauses) || []

  // -----------------------------------------------------------------------
  // Row 1: Fixture set summary  —  use basename for directory path (P6)
  // -----------------------------------------------------------------------
  var stats = (fixtureSet && fixtureSet.stats) || { totalFiles: 0, validCount: 0, invalidCount: 0 }
  var fixtureStatus = stats.totalFiles > 0 ? 'pass' : 'warn'
  var fixtureMsg = stats.totalFiles + ' files: ' + stats.validCount + ' valid, ' + stats.invalidCount + ' invalid'
  var dirLabel = (fixtureSet && fixtureSet.dir) ? path.basename(fixtureSet.dir) : ''
  rows.push(doctorRow({
    probe: 'download-fixture-set',
    status: fixtureStatus,
    count: String(stats.totalFiles),
    sampleValue: fixtureMsg,
    message: fixtureMsg + (dirLabel ? ' in ' + dirLabel : ''),
  }))

  // Add invalid fixture rows
  if (fixtureSet && fixtureSet.invalid) {
    for (var i = 0; i < fixtureSet.invalid.length; i++) {
      var inv = fixtureSet.invalid[i]
      rows.push(doctorRow({
        probe: 'fixture-' + (inv.code || 'error'),
        status: 'fail',
        count: '0',
        sampleValue: inv.code || '',
        message: inv.file + ': ' + inv.message,
      }))
    }
  }

  // -----------------------------------------------------------------------
  // Row 2: Baseline summary
  // -----------------------------------------------------------------------
  var bl = baseline || { available: false, confidence: 'low', source: 'no-success-fixture' }
  var baselineStatus = bl.available ? 'pass' : 'warn'
  var baselineMsg = bl.source + ' (' + bl.confidence + ' confidence)'
  if (bl.warnings && bl.warnings.length > 0) {
    baselineMsg += '; warnings: ' + bl.warnings.join('; ')
  }
  var expectedStr = bl.expected
    ? 'chainPattern=' + (bl.expected.chainPattern || '?') +
      ' finalHost=' + (bl.expected.finalHostClass || '?') +
      ' status=' + (bl.expected.finalStatus ?? '?')
    : 'none (no success fixtures)'
  rows.push(doctorRow({
    probe: 'download-baseline',
    status: baselineStatus,
    count: String((signatures && signatures.length) || 0),
    sampleValue: baselineMsg,
    message: 'Expected: ' + expectedStr,
  }))

  // -----------------------------------------------------------------------
  // Row 3: Outcome summary
  // -----------------------------------------------------------------------
  var successCount = 0
  var failureCount = 0
  if (signatures) {
    for (var j = 0; j < signatures.length; j++) {
      if (signatures[j].outcome === 'success') successCount++
      else failureCount++
    }
  }
  var totalOutcome = successCount + failureCount
  rows.push(doctorRow({
    probe: 'download-outcome-summary',
    status: failureCount === 0 ? 'pass' : 'warn',
    count: String(totalOutcome),
    sampleValue: successCount + ' success, ' + failureCount + ' failure',
    message: successCount + '/' + totalOutcome + ' succeeded, ' + failureCount + ' failed',
  }))

  // -----------------------------------------------------------------------
  // Row 4: Anomalies
  // -----------------------------------------------------------------------
  if (anomalies.length > 0) {
    for (var k = 0; k < anomalies.length; k++) {
      var a = anomalies[k]
      rows.push(doctorRow({
        probe: 'download-anomaly',
        status: a.severity === 'P1' ? 'fail' : 'warn',
        count: String(anomalies.filter(function (x) { return x.code === a.code }).length),
        sampleValue: a.code,
        message: a.file + ' (' + a.bookId + '): ' + a.actual + ' (expected: ' + a.expected + ')',
      }))
    }
  } else {
    rows.push(doctorRow({
      probe: 'download-anomaly',
      status: 'pass',
      count: '0',
      sampleValue: 'none',
      message: 'No anomalies detected',
    }))
  }

  // -----------------------------------------------------------------------
  // Row 5: Root causes (deduplicated by code)
  // -----------------------------------------------------------------------
  if (rootCauses.length > 0) {
    for (var m = 0; m < rootCauses.length; m++) {
      var rc = rootCauses[m]
      var hintFiles = (rc.adapterHints || []).map(function (h) { return h.file }).join(', ')
      rows.push(doctorRow({
        probe: 'download-root-cause',
        status: 'warn',
        count: String(anomalies.filter(function (x) { return x.code === rc.code }).length || 0),
        sampleValue: rc.code + ' (' + rc.confidence + ')',
        message: rc.summary + ' | Hypothesis: ' + rc.zlibraryChangeHypothesis + ' | Files: ' + hintFiles,
      }))
    }
  } else {
    rows.push(doctorRow({
      probe: 'download-root-cause',
      status: 'pass',
      count: '0',
      sampleValue: 'none',
      message: 'No root causes identified',
    }))
  }

  // -----------------------------------------------------------------------
  // Row 6: Adapter hints (combined from all root causes, deduplicated by file)
  // -----------------------------------------------------------------------
  var allHints = []
  var seenFiles = {}
  for (var n = 0; n < rootCauses.length; n++) {
    var hints = rootCauses[n].adapterHints || []
    for (var p = 0; p < hints.length; p++) {
      var hint = hints[p]
      if (!seenFiles[hint.file]) {
        seenFiles[hint.file] = true
        allHints.push(hint)
      }
    }
  }

  if (allHints.length > 0) {
    var hintMsg = allHints.map(function (h) { return h.file + ': ' + h.reason }).join('; ')
    rows.push(doctorRow({
      probe: 'download-adapter-hint',
      status: 'warn',
      count: String(allHints.length),
      sampleValue: String(allHints.length) + ' files to check',
      message: hintMsg,
    }))
  } else {
    rows.push(doctorRow({
      probe: 'download-adapter-hint',
      status: 'pass',
      count: '0',
      sampleValue: 'none',
      message: 'No adapter changes needed',
    }))
  }

  // -----------------------------------------------------------------------
  // Row 7: Machine-readable JSON report  —  ALWAYS valid JSON (P4)
  // -----------------------------------------------------------------------
  var report = buildReportJson({ fixtureSet, signatures, baseline, anomalies, rootCauses, allHints })
  var reportStr = JSON.stringify(report)
  var maxLen = 4000

  if (reportStr.length > maxLen) {
    // Do NOT truncate JSON — emit separate REPORT_TOO_LARGE row instead
    rows.push(doctorRow({
      probe: 'download-report-json',
      status: 'fail',
      count: String(report.anomalies ? report.anomalies.length : 0),
      sampleValue: 'too-large',
      message: 'Report JSON (' + reportStr.length + ' bytes) exceeds message size limit (' + maxLen + ')',
    }))
  } else {
    rows.push(doctorRow({
      probe: 'download-report-json',
      status: 'pass',
      count: String(report.anomalies ? report.anomalies.length : 0),
      sampleValue: 'ok',
      message: reportStr,
    }))
  }

  return { rows: rows, report: report }
}

/**
 * Build a structured JSON report object.
 * Exported for testing.
 *
 * @param {object} ctx
 * @returns {object}
 */
export function buildReportJson(ctx) {
  var fixtureSet = ctx.fixtureSet || {}
  var signatures = ctx.signatures || []
  var baseline = ctx.baseline || { available: false, confidence: 'low', source: 'no-success-fixture' }
  var anomalies = ctx.anomalies || []
  var rootCauses = ctx.rootCauses || []
  var allHints = ctx.allHints || []

  // Safe summary: no cookies, no raw tokens
  var summary = {
    totalFixtures: (fixtureSet.stats && fixtureSet.stats.totalFiles) || 0,
    validCount: (fixtureSet.stats && fixtureSet.stats.validCount) || 0,
    invalidCount: (fixtureSet.stats && fixtureSet.stats.invalidCount) || 0,
    signatureCount: signatures.length,
    anomalyCount: anomalies.length,
    rootCauseCount: rootCauses.length,
  }

  // Anomalies (safe: no raw trace data)
  var safeAnomalies = anomalies.map(function (a) {
    return {
      file: a.file,
      bookId: a.bookId,
      code: a.code,
      severity: a.severity,
      expected: a.expected,
      actual: a.actual,
    }
  })

  // Root causes
  var safeRootCauses = rootCauses.map(function (rc) {
    return {
      code: rc.code,
      confidence: rc.confidence,
      summary: rc.summary,
      hypothesis: rc.zlibraryChangeHypothesis,
      adapterHints: (rc.adapterHints || []).map(function (h) { return { file: h.file, reason: h.reason } }),
    }
  })

  return {
    schema: 'zlibrary-app.doctor-download.report.v1',
    generatedAt: new Date().toISOString(),
    summary: summary,
    baseline: {
      available: baseline.available !== false,
      confidence: baseline.confidence || 'low',
      source: baseline.source || 'no-success-fixture',
      expected: baseline.expected || null,
    },
    anomalies: safeAnomalies,
    rootCauses: safeRootCauses,
    adapterHints: allHints.map(function (h) { return { file: h.file, reason: h.reason } }),
  }
}
