/**
 * Additional test page builder factories for Z-Library Desktop booklist commands.
 *
 * Extends the factories in `booklist-test-utils.js` with the booklist-download
 * page builder, which is specific enough to warrant its own module.
 *
 * @module test-utils-booklist
 */

import { vi } from 'vitest'
import { createPageMock } from '../../../test-utils.js'

/** Default booklist entries used by booklist-download test scenarios */
export const DEFAULT_BOOKLISTS = [
  { id: 1, title: 'My List', description: '', bookCount: 2, createdAt: '2024-01-01' }
]

/**
 * Default book entries from getBooklistBooks  -  2 books with slug URLs.
 *
 * These match the shape returned by getBooklistBooks (DOM extraction from
 * the booklist detail page).  Each entry has a real `url` field with the
 * slug-based book URL.
 */
export const DEFAULT_MAPPINGS = [
  { readlistBookId: '1', bookId: '100', title: 'Book A', author: 'Author A', language: 'English', extension: 'epub', size: '2.39 MB', url: 'https://z-lib.gl/book/slug-a/title.html' },
  { readlistBookId: '2', bookId: '200', title: 'Book B', author: 'Author B', language: 'Japanese', extension: 'epub', size: '1.8 MB', url: 'https://z-lib.gl/book/slug-b/title.html' }
]

/**
 * Create a page mock for booklist-download tests.
 *
 * The mock simulates the new DOM-based getBooklistBooks flow:
 *
 * Evaluate call order:
 *   1. JSON.stringify(booklists)          -  getBooklists (via resolveBooklistByNameOrThrow)
 *   2. origin string                      -  getBooklistBooks: getCurrentHttpOrigin (window.location.origin)
 *   3. searchUrl string                   -  getBooklistBooks: assertSameOriginNotLoginWall after search nav
 *   4. detailHref string                  -  getBooklistBooks: DOM search extraction (<z-booklist href>)
 *                                         (retries up to 3×, first attempt succeeds in mock)
 *   5. detailUrl string                   -  getBooklistBooks: assertSameOriginNotLoginWall after detail nav
 *   6. JSON.stringify(bookId list)        -  getBooklistBooks: getBookIdList (busy-retry)
 *   7. true                               -  getBooklistBooks: busy-retry poll (z-bookcard found)
 *   8. JSON.stringify(book rows)          -  getBooklistBooks: DOM book row extraction
 *   9. origin string                      -  siteOrigin in booklist-download.js
 *  10..N  per-book: menu click, format extraction (4 evaluates per book),
 *                   6 DOM extractors (buildBookPageMetadata),
 *                   1 referer (window.location.href)
 *
 * Format extraction returns { url, label }.
 * The label is parsed for format auto-detection (e.g. "epub, 2.39 MB" → "epub").
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]
 * @param {Array<object>} [opts.mappings]
 * @param {string} [opts.origin]
 * @param {Array<{url: string, label: string}>} [opts.formatLabels]  -  Optional per-book
 *        format objects (e.g. [{ url: '/dl/100_hash', label: 'EPUB 4.2 MB' }])
 *        Defaults to { url: '/dl/<bookId>_hash', label: 'epub' }
 * @param {Array<object>} [opts.cardAttrsList]  -  Optional per-book card attribute
 *        overrides for extractBookCardAttributes (e.g. [{ md5: 'abc123' }]).
 *        When provided, length must match mappings length.
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistDownloadPage (opts = {}) {
  const {
    booklists: rawBooklists,
    mappings = DEFAULT_MAPPINGS,
    origin = 'https://z-lib.gl',
    formatLabels,
    cardAttrsList,
  } = opts

  // Auto-derive booklist bookCount from mappings to avoid triggering
  // the load-more loop in getBooklistBooks (which would consume evaluate
  // queue entries out of order in the mock).
  const booklists = rawBooklists || [
    { id: 1, title: 'My List', description: '', bookCount: mappings.length, createdAt: '2024-01-01' }
  ]

  // Build mock book row data matching getBooklistBooks DOM extraction shape
  const bookRowData = mappings.map(function (m) {
    return {
      bookId: m.bookId,
      url: m.url,
      title: m.title,
      author: m.author,
      readlistBookId: '',
      language: '',
      extension: '',
      size: ''
    }
  })

  // Build mock bookId list matching getBookIdList response shape
  const bookIdListData = mappings.map(function (m) {
    return { bookId: m.bookId, readlistBookId: Number(m.readlistBookId) || parseInt(m.readlistBookId) || 0 }
  })

  // Compute URLs matching getBooklistBooks navigation (scope default 'my')
  const searchUrl = origin + '/booklists/my?searchQuery=' + encodeURIComponent(booklists[0]?.title || 'My List')
  const detailUrl = origin + '/booklist/1/hash/list.html'

  const evals = [
    JSON.stringify(booklists),             // 0: resolveBooklistByNameOrThrow → getBooklists
    origin,                                 // 1: getBooklistBooks: getCurrentHttpOrigin
    searchUrl,                              // 2: getBooklistBooks: assertSameOriginNotLoginWall after search nav
    '/booklist/1/hash/list.html',           // 3: getBooklistBooks: search extraction → <z-booklist href>
    detailUrl,                              // 4: getBooklistBooks: assertSameOriginNotLoginWall after detail nav
    JSON.stringify(bookIdListData),         // 5: getBooklistBooks: getBookIdList (busy-retry)
    true,                                   // 6: getBooklistBooks: busy-retry poll → z-bookcard found
    JSON.stringify(bookRowData),            // 7: getBooklistBooks: DOM book row extraction
    origin,                                 // 8: booklist-download: siteOrigin
    // Quota tracker init (ensure → extractQuotaFromDom)
    origin,                                 // 9: getCurrentHttpOrigin (window.location.origin)
    origin + '/users/downloads',            // 10: assertSameOriginNotLoginWall (window.location.href)
    ({                          // 11: DOM extraction (raw object)
      countText: '0 / 10',
      resetText: 'Downloads will be reset in 14h',
      progressExists: true,
      progressAriaNow: 0,
      filenameFormatText: ''
    }),
  ]

  // Per-book evaluate calls:
  // Phase 0  -  webview health check (before extraction):
  //   0) page.evaluate('1+1') → 2
  // Phase A  -  extractNativeDownloadLink:
  //   1) checkNavigationState
  //   2) extractDownloadLinkDirect (fast-path) -> null
  //   3) tryClickDownloadMenu -> clicked
  //   4) waitForDownloadLink polling -> returns { url, label }
  // Phase B  -  buildBookPageMetadata (shared, 6 parallel extractors):
  //   5) extractBookTitle → ''
  //   6) extractBookAuthor → ''
  //   7) extractBookLanguage → ''
  //   8) extractBookFormatQualityRating → ''
  //   9) extractBookCardAttributes → {}
  //   10) extractBookDetailAttributes → {}
  // Phase C  -  referer:
  //   11) page.evaluate('window.location.href') → origin + /book/{id}
  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i]
    const labelObj = (formatLabels && formatLabels[i]) || { url: '/dl/' + mapping.bookId + '_hash', label: 'epub' }
    // Phase 0: webview health check (result is ignored, any value works)
    evals.push(2)
    // Phase A: extractNativeDownloadLink
    evals.push({
      href: origin + '/book/' + mapping.bookId,
      pathname: '/book/' + mapping.bookId,
      title: mapping.title,
      looksLikeBookPage: true,
      looksLikeLoginWall: false,
      looksLikeNotFound: false,
    })
    evals.push(null)
    evals.push({ clicked: true, tag: 'BUTTON', text: 'Download', cls: '' })
    evals.push(labelObj)
    // Phase B: buildBookPageMetadata
    evals.push('')   // extractBookTitle
    evals.push('')   // extractBookAuthor
    evals.push('')   // extractBookLanguage
    evals.push('')   // extractBookFormatQualityRating
    evals.push(JSON.stringify((cardAttrsList && cardAttrsList[i]) || {}))   // extractBookCardAttributes
    evals.push({})   // extractBookDetailAttributes
    // Note: referer evaluate was removed when migrating to CDP transport.
    // runDownloadWorkflow uses request.referer from book.url, no page.evaluate needed.
  }

  return createPageMock(evals, {
    cdp: vi.fn().mockResolvedValue({
      cookies: [{ name: 'session', value: 'abc123' }]
    })
  })
}
