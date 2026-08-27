/**
 * Tests for download-rules module.
 */

import { describe, it, expect } from 'vitest'
import { classifyDownloadRootCause, classifyDownloadRootCauses } from './download-rules.js'

describe('download-rules', function () {
  describe('classifyDownloadRootCause', function () {
    it('returns high confidence for NO_DL_REQUEST', function () {
      var rc = classifyDownloadRootCause({ code: 'NO_DL_REQUEST', file: 'f1', bookId: 'b1', severity: 'P1', expected: '', actual: '', evidence: [] })
      expect(rc.code).toBe('NO_DL_REQUEST')
      expect(rc.confidence).toBe('high')
      expect(rc.adapterHints.length).toBeGreaterThan(0)
      expect(rc.adapterHints[0].file).toBe('_shared/book-download/link.js')
    })

    it('returns high confidence for DL_STATUS_403', function () {
      var rc = classifyDownloadRootCause({ code: 'DL_STATUS_403', file: 'f1', bookId: 'b1', severity: 'P1', expected: '', actual: '', evidence: [] })
      expect(rc.code).toBe('DL_STATUS_403')
      expect(rc.confidence).toBe('high')
      expect(rc.adapterHints.length).toBeGreaterThan(0)
    })

    it('returns medium confidence for NO_CDN_REDIRECT', function () {
      var rc = classifyDownloadRootCause({ code: 'NO_CDN_REDIRECT', file: 'f1', bookId: 'b1', severity: 'P2', expected: '', actual: '', evidence: [] })
      expect(rc.code).toBe('NO_CDN_REDIRECT')
      expect(rc.confidence).toBe('medium')
    })

    it('returns low confidence for unknown code', function () {
      var rc = classifyDownloadRootCause({ code: 'UNKNOWN_BUG', file: 'f1', bookId: 'b1', severity: 'P1', expected: '', actual: '', evidence: [] })
      expect(rc.code).toBe('UNKNOWN_BUG')
      expect(rc.confidence).toBe('low')
      expect(rc.adapterHints[0].file).toContain('doctor-download-v2')
    })
  })

  describe('classifyDownloadRootCauses', function () {
    it('returns empty for no anomalies', function () {
      var result = classifyDownloadRootCauses({ anomalies: [] })
      expect(result.rootCauses.length).toBe(0)
    })

    it('deduplicates by code', function () {
      var anomalies = [
        { code: 'DL_STATUS_204' },
        { code: 'DL_STATUS_204' },
        { code: 'DL_STATUS_403' },
      ]
      var result = classifyDownloadRootCauses({ anomalies: anomalies })
      expect(result.rootCauses.length).toBe(2)
    })

    it('includes adapter hints for each root cause', function () {
      var anomalies = [{ code: 'CDN_HTML_BLOCK' }, { code: 'MD5_MISMATCH' }]
      var result = classifyDownloadRootCauses({ anomalies: anomalies })
      expect(result.rootCauses.length).toBe(2)
      for (var i = 0; i < result.rootCauses.length; i++) {
        expect(result.rootCauses[i].adapterHints.length).toBeGreaterThan(0)
      }
    })
  })
})
