/**
 * Test utilities for Z-Library Desktop download command tests.
 *
 * Provides mock response and page mock builders used by both root download
 * and download-history command tests.
 *
 * @module test-utils-download
 */

import { vi } from 'vitest'
import { Readable } from 'node:stream'
import https from 'node:https'
import { createPageMock } from '../../../test-utils.js'

/**
 * Create a readable stream response for https.get mock.
 * @param {Buffer|string} content
 * @param {number} statusCode
 * @returns {import('node:stream').Readable}
 */
export function createMockResponse (content, statusCode = 200) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
  const resp = new Readable({
    read () {
      this.push(buf)
      this.push(null)
    }
  })
  resp.statusCode = statusCode
  resp.headers = {}
  return resp
}

/**
 * Create a page mock with a cdp stub for download tests.
 * @param {any[]} evaluateResults
 * @param {Function} [cdpMock]
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createDownloadPage (evaluateResults, cdpMock) {
  return createPageMock(evaluateResults, {
    cdp: vi.fn(cdpMock || (() => Promise.resolve({ cookies: [] })))
  })
}

/**
 * Create a page mock for download-history command tests.
 *
 * Sets up evaluate sequence:
 *   1. window.location.origin  -  used to build absolute navigation URL
 *   2. evaluateJson script  -  returns the rows as JSON
 *
 * @param {Array<object>} rows  -  download history rows to return
 * @param {string} [origin='https://z-lib.gl']  -  mock page origin
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createDownloadsPage (rows, origin = 'https://z-lib.gl') {
  return createPageMock([
    origin,
    JSON.stringify(rows)
  ])
}

/**
 * Create a page mock for download command with --book-id URL/ID input.
 *
 * Handles the evaluate sequence produced by navigateAndExtractBookId:
 *   1. [if origin] window.location.origin  -  same-origin check
 *   2. extractCurrentBookId  -  plain evaluate, returns string
 *   3. extractBookCard  -  evaluateJson, returns JSON string
 *   4. window.location.origin  -  download URL validation
 *
 * @param {{ origin?: string, extractedBookId: string, cardData: object, cookies?: Array<object> }} opts
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createDownloadPageForSelector (opts) {
  const { origin, extractedBookId, cardData, cookies = [{ name: 's', value: 'v', domain: 'example.com' }] } = opts
  const evals = []
  if (origin) {
    evals.push(origin) // page.evaluate('window.location.origin')  -  origin check
  }
  evals.push(extractedBookId) // page.evaluate()  -  extractCurrentBookId (plain string)
  evals.push(JSON.stringify(cardData)) // evaluateJson  -  extractBookCard
  evals.push(origin || 'https://example.com') // page.evaluate('window.location.origin')  -  download URL validation
  return createDownloadPage(evals, vi.fn().mockResolvedValue({ cookies }))
}

/**
 * Mock https.get to return a successful download response.
 * Replaces the repetitive mockImplementation pattern in download tests.
 *
 * Call in test instead of:
 *   const mockResp = createMockResponse(content);
 *   vi.mocked(https.get).mockImplementation((url, opts, cb) => { ... });
 *
 * @param {string} [content='download content']
 * @returns {import('vitest').MockedFunction}
 */
export function mockHttpsDownload (content = 'download content') {
  const mockResp = createMockResponse(content)
  const impl = vi.fn((url, opts, cb) => {
    if (typeof opts === 'function') cb = opts
    if (cb) cb(mockResp)
    return { on: vi.fn(), destroy: vi.fn() }
  })
  vi.mocked(https.get).mockImplementation(impl)
  return impl
}
