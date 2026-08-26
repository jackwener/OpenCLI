/**
 * Tests for download-diff module.
 */

import { describe, it, expect } from 'vitest'
import { diffDownloadAgainstBaseline } from './download-diff.js'
import { deriveDownloadBaseline } from './download-baseline.js'
import { toDownloadSignature } from './download-signature.js'
import {
  createSuccessFixture,
  create204GateFixture,
  create403Fixture,
  createHtmlBlockFixture,
  createNoCdnFixture,
  createMd5MismatchFixture,
  createZeroStreamFixture,
  createInsufficientFixture,
} from '../fixture/test/traces.js'

describe('download-diff', function () {
  var successSig = toDownloadSignature({ file: 'success.fixture.json', trace: createSuccessFixture() })
  var baseline = deriveDownloadBaseline({ signatures: [successSig] })

  it('no anomalies for success-only fixture set', function () {
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [successSig] })
    expect(result.anomalies.length).toBe(0)
  })

  it('DL_STATUS_204 for 204 gate fixture (precedence 2)', function () {
    var sig = toDownloadSignature({ file: '204.fixture.json', trace: create204GateFixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('DL_STATUS_204')
    expect(result.anomalies[0].severity).toBe('P1')
  })

  it('DL_STATUS_403 for 403 fixture (precedence 2)', function () {
    var sig = toDownloadSignature({ file: '403.fixture.json', trace: create403Fixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('DL_STATUS_403')
  })

  it('CDN_HTML_BLOCK for HTML block fixture (precedence 4)', function () {
    var sig = toDownloadSignature({ file: 'html-block.fixture.json', trace: createHtmlBlockFixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('CDN_HTML_BLOCK')
  })

  it('NO_CDN_REDIRECT for non-CDN final host (precedence 7)', function () {
    var sig = toDownloadSignature({ file: 'nocdn.fixture.json', trace: createNoCdnFixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('NO_CDN_REDIRECT')
  })

  it('MD5_MISMATCH for MD5 mismatch fixture (precedence 5)', function () {
    var sig = toDownloadSignature({ file: 'md5-bad.fixture.json', trace: createMd5MismatchFixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('MD5_MISMATCH')
  })

  it('STREAM_ZERO_BYTES for zero stream fixture (precedence 6)', function () {
    var sig = toDownloadSignature({ file: 'zero-stream.fixture.json', trace: createZeroStreamFixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].code).toBe('STREAM_ZERO_BYTES')
  })

  it('no anomalies for empty signatures', function () {
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [] })
    expect(result.anomalies.length).toBe(0)
  })

  it('anomalies include file info and evidence', function () {
    var sig = toDownloadSignature({ file: '403.fixture.json', trace: create403Fixture() })
    var result = diffDownloadAgainstBaseline({ baseline: baseline, signatures: [sig] })
    var anomaly = result.anomalies[0]
    expect(anomaly.file).toBe('403.fixture.json')
    expect(anomaly.bookId).toBeTruthy()
    expect(anomaly.severity).toBe('P1')
    expect(anomaly.evidence.length).toBeGreaterThan(0)
  })
})
