/**
 * Test page builder factories for Z-Library Desktop search/info commands.
 *
 * These builders protect tests from internal evaluate-call ordering changes
 * by providing named parameters instead of raw `createPageMock` arrays.
 *
 * @module test-utils-search
 */

import { createPageMock } from '../../../test-utils.js'

/**
 * Create a page mock for search command tests.
 *
 * The search command flow (without --detail):
 *   1. evaluate('window.location.origin') → origin string
 *   2. page navigation / submitSearchQuery
 *   3. evaluate('window.location.href') → final URL (check for login wall)
 *   4. evaluateJson → JSON-serialized search results
 *
 * With --detail, after step 4, for each result with a url:
 *   5. page.goto → detail page
 *   6. evaluate('window.location.href') → detail page URL (trust boundary)
 *   7. buildBookPageMetadata (6 internal evaluate calls):
 *      a. evaluate → extractBookTitle
 *      b. evaluate → extractBookAuthor
 *      c. evaluate → extractBookLanguage
 *      d. evaluate → extractBookFormatQualityRating
 *      e. evaluateJson → extractBookCardAttributes (JSON-serialized object)
 *      f. evaluateJson → extractBookDetailAttributes (JSON-serialized object)
 *   8. evaluate → extractDownloadLinkFromCurrentPage (no /dl/ link in test fixtures)
 *
 * The `detailResults` option provides mock data for step 7f for each result.
 * The optional `detailCardAttrs` provides mock data for step 7e.
 *
 * @param {{ origin?: string, href?: string, results?: Array<object>, detailResults?: Array<object>, detailCardAttrs?: Array<object>, detailTitles?: Array<string>, detailAuthors?: Array<string>, detailLanguages?: Array<string>, detailQualityRatings?: Array<string> }} [opts]
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createSearchCommandPage (opts = {}) {
  const {
    origin = 'https://z-lib.sk',
    href = origin + '/s/test',
    results = [],
    detailResults,
    detailCardAttrs,
    detailTitles = [],
    detailAuthors = [],
    detailLanguages = [],
    detailQualityRatings = []
  } = opts
  const evals = [
    origin,
    href,
    JSON.stringify(results),
  ]
  // When --detail is used, each result with a url gets:
  //   - evaluate('window.location.href') → detail page href
  //   - buildBookPageMetadata → 6 internal evaluate calls
  //   - evaluate → extractDownloadLinkFromCurrentPage (fails silently)
  if (detailResults) {
    for (let i = 0; i < detailResults.length; i++) {
      const dr = detailResults[i]
      // Skip entries for results without url (they won't trigger navigation)
      const resultUrl = results[i]?.url
      if (resultUrl) {
        evals.push(resultUrl) // trust boundary check: window.location.href
      }
      // buildBookPageMetadata internally calls 6 extractors:
      // 1. extractBookTitle → evaluate
      evals.push(detailTitles[i] != null ? detailTitles[i] : 'Detailed Book Title')
      // 2. extractBookAuthor → evaluate
      evals.push(detailAuthors[i] != null ? detailAuthors[i] : 'Test Author')
      // 3. extractBookLanguage → evaluate (must be a known language name)
      evals.push(detailLanguages[i] != null ? detailLanguages[i] : 'English')
      // 4. extractBookFormatQualityRating → evaluate
      evals.push(detailQualityRatings[i] != null ? detailQualityRatings[i] : '4.5')
      // 5. extractBookCardAttributes → evaluateJson (JSON-serialized object)
      const cardAttrs = detailCardAttrs && detailCardAttrs[i] ? detailCardAttrs[i] : {}
      evals.push(JSON.stringify(cardAttrs))
      // 6. extractBookDetailAttributes → evaluateJson (JSON-serialized object)
      evals.push(JSON.stringify(dr))
      // extractDownloadLinkFromCurrentPage → evaluate (no /dl/ link found)
      evals.push('')
    }
  }
  return createPageMock(evals)
}

/**
 * Create a page mock for info command tests.
 *
 * Evaluate call order (with navigation via --book-id):
 *   1. page.evaluate('window.location.origin')  -  getCurrentHttpOrigin (always)
 *   2. page.evaluate('window.location.origin')  -  navigateToBookSelector origin check (URL kind only)
 *   3. page.evaluate('window.location.href')  -  assertSameOriginNotLoginWall (after navigation)
 *   4. page.evaluate  -  extractBookTitle
 *   5. page.evaluate  -  clickFormatsMenu
 *   6. evaluateJson  -  extractFormats
 *   7. page.evaluate  -  card attribute extraction
 *   8. evaluateJson  -  extractBookDetailAttributes (--detail only)
 *
 * @param {{ origin?: string, title?: string, formats?: { pdf?: string, epub?: string, azw3?: string, mobi?: string }, selector?: { origin?: string }, href?: string, detailAttr?: object, cardAttrs?: object }} [opts]
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createInfoCommandPage (opts = {}) {
  const { origin = 'https://z-lib.sk', title = 'Test Book', formats = { pdf: '', epub: '', azw3: '', mobi: '' }, selector, href, detailAttr, cardAttrs } = opts
  const evals = []

  // 1. getCurrentHttpOrigin  -  always runs
  evals.push(origin)

  // 2. navigateToBookSelector origin check (absolute URL kind only)
  if (selector && selector.origin) {
    evals.push(selector.origin)
  }

  // 3. navigateToBookSelector URL resolution (always runs when navigating)
  if (href) {
    evals.push(origin)
  }

  // 4. assertSameOriginNotLoginWall  -  after navigation, evaluates window.location.href
  if (href) {
    evals.push(href)
  }

  evals.push(title)
  evals.push(undefined) // clickFormatsMenu evaluate
  evals.push(JSON.stringify(formats))
  // Card attribute evaluate (always runs  -  returns JSON-serialized string)
  const cardData = cardAttrs || { publisher: '', isbn: '' }
  evals.push(JSON.stringify(cardData))
  if (detailAttr) {
    evals.push(JSON.stringify(detailAttr))
  }
  return createPageMock(evals)
}

/**
 * Default result shape matching the 17-column schema.
 * @type {object}
 */
export const DEFAULT_SEARCH_RESULT = {
  rank: 1,
  title: 'Test Book',
  author: 'Test Author',
  year: '2024',
  language: 'English',
  extension: 'pdf',
  'content-type': 'book',
  size: '2.5 MB',
  url: 'https://z-lib.sk/book/1',
  id: '12345',
  'quality-rating': '5.0',
  'format-quality-rating': '4.0',
  favorite: false,
  booklist: false,
  downloaded: false,
  publisher: '',
  isbn: '',
  pages: '',
  'isbn-10': '',
  'isbn-13': '',
  series: '',
  volume: '',
  categories: '',
  description: '',
  'meta-description': '',
  'language-code': '',
  'detail-error': null
}

/**
 * Default result shape with --detail fields populated.
 * @type {object}
 */
export const DETAILED_SEARCH_RESULT = {
  ...DEFAULT_SEARCH_RESULT,
  pages: '350',
  'isbn-10': '1234567890',
  'isbn-13': '9781234567890',
  series: 'The Great Series',
  volume: 'Vol. 3',
  categories: 'Fiction, Mystery',
  description: 'A detailed description of the book.',
  'detail-error': null
}
