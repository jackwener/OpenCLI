/**
 * Tests for download-baseline module.
 */

import { describe, it, expect } from 'vitest'
import { deriveDownloadBaseline } from './download-baseline.js'
import { toDownloadSignature } from './download-signature.js'
import { createSuccessFixture } from '../fixture/test/traces.js'

describe('download-baseline', function () {
  it('returns no-baseline when no signatures', function () {
    var bl = deriveDownloadBaseline({ signatures: [] })
    expect(bl.available).toBe(false)
    expect(bl.confidence).toBe('low')
    expect(bl.source).toBe('no-success-fixture')
    expect(bl.expected).toBeNull()
  })

  it('returns no-baseline when signatures is null', function () {
    var bl = deriveDownloadBaseline({ signatures: null })
    expect(bl.available).toBe(false)
    expect(bl.source).toBe('no-success-fixture')
  })

  it('returns no-baseline when no success signatures', function () {
    var bl = deriveDownloadBaseline({
      signatures: [{ outcome: 'failure', file: 'f1', chainPattern: '1-hop', finalHostClass: 'none', finalStatus: 403, artifactSize: 0, streamBytes: 0, suppressAction: 'Aborted' }],
    })
    expect(bl.available).toBe(false)
    expect(bl.source).toBe('no-success-fixture')
  })

  it('derives baseline from success signatures', function () {
    var sig = toDownloadSignature({ file: 's1.fixture.json', trace: createSuccessFixture() })
    var bl = deriveDownloadBaseline({ signatures: [sig] })
    expect(bl.available).toBe(true)
    expect(bl.confidence).toBe('medium')
    expect(bl.source).toBe('derived-from-success-fixtures')
    expect(bl.expected.chainPattern).toContain('200:Fetch:file-cdn')
    expect(bl.expected.finalHostClass).toBe('file-cdn')
    expect(bl.expected.finalStatus).toBe(200)
    expect(bl.expected.htmlDetected).toBe(false)
    expect(bl.expected.minArtifactBytes).toBeGreaterThan(0)
    expect(bl.sampleFiles).toContain('s1.fixture.json')
  })

  it('derives baseline with high confidence from 3+ success signatures', function () {
    var sigs = [
      toDownloadSignature({ file: 's1.fixture.json', trace: createSuccessFixture() }),
      toDownloadSignature({ file: 's2.fixture.json', trace: createSuccessFixture() }),
      toDownloadSignature({ file: 's3.fixture.json', trace: createSuccessFixture() }),
    ]
    var bl = deriveDownloadBaseline({ signatures: sigs })
    expect(bl.confidence).toBe('high')
  })

  it('detects stream/artifact mismatch in baseline', function () {
    var trace = createSuccessFixture()
    trace.transport.streamBytes = 12345
    var sig = toDownloadSignature({ file: 's1.fixture.json', trace: trace })
    expect(sig.streamBytes).toBe(12345)
    expect(sig.artifactSize).toBe(65536)
  })
})
