// @ts-check

/**
 * Diagnostic probe framework for zlibrary-app.
 *
 * Defines `DiagnosticProbeSpec` contract: collect, sanitize, toSnapshotEntry,
 * compare, toDoctorRows. Live probes call collect/sanitize/toSnapshotEntry.
 * Doctor commands read fixture evidence and call compare/toDoctorRows.
 *
 * @module _shared/diagnostic-probe
 */

import { sanitizeDownloadTraceUrl } from '../book-download/contracts.js'
import { doctorRow } from '../snapshot/rows.js'

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DiagnosticProbeSpec
 * @property {string} name  -  unique probe name
 * @property {function(): Promise<Object>} collect  -  collect live data from page/CDP
 * @property {function(Object): Object} sanitize  -  redact PII/tokens from collected data
 * @property {function(string, Object): Object} toSnapshotEntry  -  wrap data for snapshot fixture
 * @property {function(Object, Object): Array} compare  -  compare collected vs fixture, return doctor rows
 * @property {function(Array): Array} toDoctorRows  -  convert compare results to CLI output rows
 */

// ---------------------------------------------------------------------------
// URL probe
// ---------------------------------------------------------------------------

/**
 * URL probe: collect page origin and download URLs, sanitize tokens.
 *
 * @type {DiagnosticProbeSpec}
 */
export const urlProbe = {
  name: 'url',

  /**
   * Collect current page URL info.
   * @returns {Promise<{origin: string, href: string, dlLinks: string[]}>}
   */
  async collect() {
    // collect is async and takes no params  -  caller provides page
    return { origin: '', href: '', dlLinks: [] }
  },

  /**
   * Sanitize URLs by redacting /dl/<token> paths.
   * @param {{origin?:string, href?:string, dlLinks?:string[]}} data
   * @returns {{origin:string, hrefSanitized:string, dlLinksSanitized:string[]}}
   */
  sanitize(data) {
    return {
      origin: data.origin || '',
      hrefSanitized: sanitizeDownloadTraceUrl(data.href) || data.href || '',
      dlLinksSanitized: (data.dlLinks || []).map(sanitizeDownloadTraceUrl),
    }
  },

  /**
   * Wrap probe data into a snapshot entry.
   * @param {string} entryKey
   * @param {Object} sanitizedData
   * @returns {Object}
   */
  toSnapshotEntry(entryKey, sanitizedData) {
    return {
      [entryKey]: {
        kind: 'url',
        capturedAt: new Date().toISOString(),
        data: sanitizedData,
      },
    }
  },

  /**
   * Compare collected vs fixture URL data.
   * @param {Object} collected
   * @param {Object} fixture
   * @returns {Array<{probe:string, status:string, count:number, sampleValue:string, message:string}>}
   */
  compare(collected, fixture) {
    const rows = []
    const c = collected || {}
    const f = fixture || {}

    if (c.origin && f.origin && c.origin !== f.origin) {
      rows.push({
        probe: 'url-origin',
        status: 'fail',
        count: 1,
        sampleValue: c.origin,
        message: `Origin mismatch: collected "${c.origin}" vs fixture "${f.origin}"`,
      })
    }

    if (c.hrefSanitized && f.hrefSanitized && c.hrefSanitized !== f.hrefSanitized) {
      rows.push({
        probe: 'url-href',
        status: 'warn',
        count: 1,
        sampleValue: c.hrefSanitized,
        message: 'Page URL changed since fixture capture',
      })
    }

    return rows
  },

  /**
   * Convert compare results to CLI doctor rows.
   * @param {Array} compareResults
   * @returns {Array}
   */
  toDoctorRows(compareResults) {
    return compareResults.map((r) =>
      doctorRow({
        probe: r.probe,
        status: r.status,
        count: r.count,
        sampleValue: r.sampleValue,
        message: r.message,
      })
    )
  },
}


