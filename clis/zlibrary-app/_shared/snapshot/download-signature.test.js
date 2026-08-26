/**
 * Tests for download-signature module.
 */

import { describe, it, expect } from 'vitest'
import { toDownloadSignature, classifyOutcome } from './download-signature.js'
import {
  createSuccessFixture,
  create204GateFixture,
  create403Fixture,
  createHtmlBlockFixture,
  createNoCdnFixture,
  createMd5MismatchFixture,
  createZeroStreamFixture,
  createInsufficientFixture,
  createSecretFixture,
} from '../fixture/test/traces.js'

describe('download-signature', function () {
  describe('toDownloadSignature', function () {
    it('classifies success fixture as success outcome', function () {
      var sig = toDownloadSignature({ file: 'success.fixture.json', trace: createSuccessFixture() })
      expect(sig.file).toBe('success.fixture.json')
      expect(sig.outcome).toBe('success')
      expect(sig.artifactSize).toBeGreaterThan(0)
      expect(sig.finalHostClass).toBe('file-cdn')
      expect(sig.finalStatus).toBe(200)
      expect(sig.md5Status).toBe('matched')
      expect(sig.htmlDetected).toBe(false)
      expect(sig.chainPattern).toContain('302:Fetch:same-origin')
      expect(sig.chainPattern).toContain('200:Fetch:file-cdn')
    })

    it('classifies 204 gate fixture as failure', function () {
      var sig = toDownloadSignature({ file: '204.fixture.json', trace: create204GateFixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.artifactSize).toBe(0)
      expect(sig.streamBytes).toBe(0)
      expect(sig.errorMessageClass).toContain('http:204')
      expect(sig.evidence).toContain('request-aborted')
    })

    it('classifies 403 fixture as failure', function () {
      var sig = toDownloadSignature({ file: '403.fixture.json', trace: create403Fixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.hopStatuses).toContain(403)
      expect(sig.errorMessageClass).toContain('http:403')
    })

    it('detects HTML block page', function () {
      var sig = toDownloadSignature({ file: 'html-block.fixture.json', trace: createHtmlBlockFixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.htmlDetected).toBe(true)
      expect(sig.evidence).toContain('html-block-page')
    })

    it('detects no-CDN redirect', function () {
      var sig = toDownloadSignature({ file: 'nocdn.fixture.json', trace: createNoCdnFixture() })
      expect(sig.finalHostClass).toBe('other')
      expect(sig.finalHostClass).not.toBe('file-cdn')
    })

    it('detects MD5 mismatch', function () {
      var sig = toDownloadSignature({ file: 'md5-bad.fixture.json', trace: createMd5MismatchFixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.md5Status).toBe('mismatched')
      expect(sig.evidence).toContain('md5-mismatch')
    })

    it('detects zero stream bytes', function () {
      var sig = toDownloadSignature({ file: 'zero-stream.fixture.json', trace: createZeroStreamFixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.streamBytes).toBe(0)
      expect(sig.artifactSize).toBe(0)
      expect(sig.evidence).toContain('zero-bytes')
    })

    it('classifies insufficient fixture', function () {
      var sig = toDownloadSignature({ file: 'insufficient.fixture.json', trace: createInsufficientFixture() })
      expect(sig.outcome).toBe('failure')
      expect(sig.evidence).toContain('zero-bytes')
    })

    it('extracts bookId and command', function () {
      var sig = toDownloadSignature({ file: 'test.fixture.json', trace: createSuccessFixture() })
      expect(sig.bookId).toBeTruthy()
      expect(sig.command).toBe('download')
    })

    it('extracts origin host safely', function () {
      var sig = toDownloadSignature({ file: 'test.fixture.json', trace: createSuccessFixture() })
      expect(sig.originHost).toBe('z-lib.gl')
    })

    it('chainPattern reflects hop structure', function () {
      var sig = toDownloadSignature({ file: 'test.fixture.json', trace: createSuccessFixture() })
      expect(sig.chainPattern).toMatch(/^.+ -> .+ -> .+$/)
      expect(sig.chainPattern).not.toBe('(empty)')
    })
  })

  describe('no-secret-leak', function () {
    it('does not expose cookie values in signature', function () {
      var sig = toDownloadSignature({ file: 'secret.fixture.json', trace: createSecretFixture() })
      var fullStr = JSON.stringify(sig)
      expect(fullStr).not.toContain('s3cr3t_t0k3n_v4lu3')
      expect(sig.evidence.some(function (e) { return e.includes('cookies') || e.includes('session') })).toBe(false)
    })

    it('does not expose raw URLs with tokens', function () {
      var sig = toDownloadSignature({ file: 'secret.fixture.json', trace: createSecretFixture() })
      var fullStr = JSON.stringify(sig)
      expect(fullStr).not.toContain('/dl/tokenSecret')
      expect(fullStr).not.toContain('/dl/token123')
    })
  })

  describe('classifyOutcome', function () {
    it('returns success for healthy fixture fields', function () {
      var result = classifyOutcome({
        artifactSize: 65536,
        artifactMd5: 'abc123',
        md5Status: 'matched',
        htmlDetected: false,
        streamBytes: 65536,
        finalStatus: 200,
        error: null,
        chainPattern: '302:Fetch:same-origin -> 200:Fetch:file-cdn',
      })
      expect(result).toBe('success')
    })

    it('returns failure for HTML detected', function () {
      expect(classifyOutcome({
        artifactSize: 8192, artifactMd5: '', md5Status: 'unavailable',
        htmlDetected: true, streamBytes: 8192, finalStatus: 200, error: null, chainPattern: '1-hop',
      })).toBe('failure')
    })

    it('returns failure for MD5 mismatch', function () {
      expect(classifyOutcome({
        artifactSize: 65536, artifactMd5: 'aaa', md5Status: 'mismatched',
        htmlDetected: false, streamBytes: 65536, finalStatus: 200, error: null, chainPattern: '2-hop',
      })).toBe('failure')
    })

    it('returns failure for HTTP 4xx final', function () {
      expect(classifyOutcome({
        artifactSize: 0, artifactMd5: '', md5Status: 'unavailable',
        htmlDetected: false, streamBytes: 0, finalStatus: 403, error: null, chainPattern: '1-hop',
      })).toBe('failure')
    })
  })
})
