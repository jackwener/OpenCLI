/**
 * Tests for download-report module.
 */

import { describe, it, expect } from 'vitest'
import { buildDoctorDownloadReport, buildReportJson } from './download-report.js'

/**
 * Build a minimal fixture set-like object.
 */
function sampleFixtureSet() {
  return {
    dir: '/tmp/fixtures',
    valid: [
      { file: 'a.fixture.json', trace: {} },
      { file: 'b.fixture.json', trace: {} },
    ],
    invalid: [],
    stats: { totalFiles: 2, validCount: 2, invalidCount: 0 },
  }
}

function sampleBaseline() {
  return {
    available: true,
    confidence: 'high',
    source: 'derived-from-success-fixtures',
    expected: { chainPattern: '302:Fetch:same-origin -> 200:Fetch:file-cdn', finalHostClass: 'file-cdn', finalStatus: 200, minArtifactBytes: 4096, streamMatchesArtifact: true, htmlDetected: false, suppressAction: 'fulfill' },
    sampleFiles: ['a.fixture.json'],
    warnings: [],
  }
}

function sampleSignatures() {
  return [
    { file: 'a.fixture.json', bookId: 'book-001', outcome: 'success', originHost: 'z-lib.gl', chainPattern: '302:Fetch:same-origin -> 200:Fetch:file-cdn', hopStatuses: [302, 302, 200], hopTypes: ['Fetch', 'Fetch', 'Fetch'], finalHostClass: 'file-cdn', finalStatus: 200, artifactSize: 65536, streamBytes: 65536, chunks: 4, suppressAction: 'fulfill', md5Status: 'matched', htmlDetected: false, errorPhase: '', errorType: '', errorMessageClass: '', evidence: [] },
    { file: 'b.fixture.json', bookId: 'book-002', outcome: 'failure', originHost: 'z-lib.gl', chainPattern: '1-hop chain', hopStatuses: [403], hopTypes: ['Fetch'], finalHostClass: 'other', finalStatus: 403, artifactSize: 0, streamBytes: 0, chunks: 0, suppressAction: 'Aborted', md5Status: 'unavailable', htmlDetected: false, errorPhase: 'response', errorType: 'HTTPError', errorMessageClass: 'phase:response type:HTTPError http:403', evidence: ['has-error:phase:response type:HTTPError http:403', 'request-aborted'] },
  ]
}

describe('download-report', function () {
  describe('buildDoctorDownloadReport', function () {
    it('produces rows for a healthy fixture set', function () {
      var fixtureSet = sampleFixtureSet()
      var signatures = sampleSignatures()
      var baseline = sampleBaseline()
      var diffResult = { anomalies: [] }
      var rootCauseResult = { rootCauses: [] }

      var result = buildDoctorDownloadReport({ fixtureSet, signatures, baseline, diffResult, rootCauseResult })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.report).toBeTruthy()
    })

    it('includes fixture-set summary row', function () {
      var result = buildDoctorDownloadReport({
        fixtureSet: sampleFixtureSet(),
        signatures: sampleSignatures(),
        baseline: sampleBaseline(),
        diffResult: { anomalies: [] },
        rootCauseResult: { rootCauses: [] },
      })
      var fixtureRow = result.rows.find(function (r) { return r.probe === 'download-fixture-set' })
      expect(fixtureRow).toBeTruthy()
      expect(fixtureRow.count).toBe('2')
    })

    it('fixture-set summary uses basename not full path (P6)', function () {
      var result = buildDoctorDownloadReport({
        fixtureSet: sampleFixtureSet(),
        signatures: sampleSignatures(),
        baseline: sampleBaseline(),
        diffResult: { anomalies: [] },
        rootCauseResult: { rootCauses: [] },
      })
      var fixtureRow = result.rows.find(function (r) { return r.probe === 'download-fixture-set' })
      // Should contain 'fixtures' (basename), not '/tmp/fixtures' full path
      expect(fixtureRow.message).toContain('in fixtures')
      expect(fixtureRow.message).not.toContain('/tmp/fixtures')
    })

    it('includes anomaly rows when anomalies exist', function () {
      var result = buildDoctorDownloadReport({
        fixtureSet: sampleFixtureSet(),
        signatures: sampleSignatures(),
        baseline: sampleBaseline(),
        diffResult: { anomalies: [{ code: 'DL_STATUS_403', file: 'b.fixture.json', bookId: 'book-002', severity: 'P1', expected: 'non-403', actual: '403', evidence: [] }] },
        rootCauseResult: { rootCauses: [{ code: 'DL_STATUS_403', confidence: 'high', summary: 'test', zlibraryChangeHypothesis: 'test-hypothesis', adapterHints: [{ file: 'test.js', reason: 'test reason' }] }] },
      })
      var anomalyRows = result.rows.filter(function (r) { return r.probe === 'download-anomaly' })
      expect(anomalyRows.length).toBeGreaterThan(0)
      expect(anomalyRows[0].status).toBe('fail') // P1 = fail
    })

    it('report JSON is parseable', function () {
      var result = buildDoctorDownloadReport({
        fixtureSet: sampleFixtureSet(),
        signatures: sampleSignatures(),
        baseline: sampleBaseline(),
        diffResult: { anomalies: [{ code: 'DL_STATUS_403', file: 'b.fixture.json', bookId: 'book-002', severity: 'P1', expected: '', actual: '', evidence: [] }] },
        rootCauseResult: { rootCauses: [{ code: 'DL_STATUS_403', confidence: 'high', summary: 'test', zlibraryChangeHypothesis: 'test', adapterHints: [{ file: 'test.js', reason: 'test' }] }] },
      })
      var reportJson = result.report
      expect(reportJson.schema).toBe('zlibrary-app.doctor-download.report.v1')
      expect(reportJson.summary).toBeTruthy()
      expect(reportJson.anomalies.length).toBe(1)
      expect(reportJson.rootCauses.length).toBe(1)
    })

    it('emits REPORT_TOO_LARGE probe when JSON exceeds message limit (P4)', function () {
      // Create a fixture set with many signatures to generate a large report
      var manySignatures = []
      for (var i = 0; i < 500; i++) {
        manySignatures.push({ file: 'f' + i + '.fixture.json', bookId: 'b' + i, outcome: 'failure', chainPattern: '1-hop', hopStatuses: [403], hopTypes: ['Fetch'], finalHostClass: 'other', finalStatus: 403, artifactSize: 0, streamBytes: 0, chunks: 0, suppressAction: 'Aborted', md5Status: 'unavailable', htmlDetected: false, errorPhase: 'response', errorType: 'HTTPError', errorMessageClass: 'http:403', evidence: ['status-403'] })
      }
      var manyAnomalies = manySignatures.map(function (s) { return { code: 'DL_STATUS_403', file: s.file, bookId: s.bookId, severity: 'P1', expected: 'non-403', actual: '403', evidence: [] } })
      var result = buildDoctorDownloadReport({
        fixtureSet: { dir: '/tmp/d', valid: [], invalid: [], stats: { totalFiles: 500, validCount: 500, invalidCount: 0 } },
        signatures: manySignatures,
        baseline: sampleBaseline(),
        diffResult: { anomalies: manyAnomalies },
        rootCauseResult: { rootCauses: [{ code: 'DL_STATUS_403', confidence: 'high', summary: 'test', zlibraryChangeHypothesis: 'test', adapterHints: [{ file: 'test.js', reason: 'test' }] }] },
      })
      var jsonRow = result.rows.find(function (r) { return r.probe === 'download-report-json' })
      expect(jsonRow).toBeTruthy()
      expect(jsonRow.status).toBe('fail')
      expect(jsonRow.sampleValue).toBe('too-large')
      expect(jsonRow.message).toContain('exceeds message size limit')
      // JSON in report object must still be valid
      var parsed = JSON.parse(JSON.stringify(result.report))
      expect(parsed.schema).toBe('zlibrary-app.doctor-download.report.v1')
    })
  })

  describe('no-cookie-leak', function () {
    it('report JSON does not contain cookie values', function () {
      var fixtureSet = {
        dir: '/tmp/f',
        valid: [{ file: 'secret.fixture.json', trace: { trigger: { cookies: [{ name: 'session', value: 's3cr3t_t0k3n_v4lu3' }] } } }],
        invalid: [],
        stats: { totalFiles: 1, validCount: 1, invalidCount: 0 },
      }
      var result = buildDoctorDownloadReport({
        fixtureSet: fixtureSet,
        signatures: [{ file: 'secret.fixture.json', bookId: 'b1', outcome: 'success', chainPattern: '', hopStatuses: [], hopTypes: [], finalHostClass: '', finalStatus: null, artifactSize: 0, streamBytes: 0, chunks: 0, suppressAction: '', md5Status: 'unavailable', htmlDetected: false, errorPhase: '', errorType: '', errorMessageClass: '', evidence: [], originHost: '', command: '' }],
        baseline: sampleBaseline(),
        diffResult: { anomalies: [] },
        rootCauseResult: { rootCauses: [] },
      })
      var reportStr = JSON.stringify(result.report)
      expect(reportStr).not.toContain('s3cr3t_t0k3n_v4lu3')
    })
  })

  describe('buildReportJson', function () {
    it('builds valid JSON report structure', function () {
      var report = buildReportJson({
        fixtureSet: sampleFixtureSet(),
        signatures: sampleSignatures(),
        baseline: sampleBaseline(),
        anomalies: [],
        rootCauses: [],
        allHints: [],
      })
      expect(report.schema).toBe('zlibrary-app.doctor-download.report.v1')
      expect(report.summary.signatureCount).toBe(2)
      expect(report.baseline.available).toBe(true)
    })
  })
})
