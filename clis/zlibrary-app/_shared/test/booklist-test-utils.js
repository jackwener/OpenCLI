/**
 * Test page builder factories for Z-Library Desktop booklist commands.
 *
 * These builders protect tests from internal evaluate-call ordering changes
 * by providing named parameters instead of raw `createPageMock` arrays.
 *
 * @module booklist-test-utils
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPageMock } from '../../../test-utils.js'

/**
 * Load a committed booklist fixture used as the canonical testing source.
 *
 * Tests should prefer this over ad-hoc invented mock payloads.
 *
 * @param {string} [variant='anonymous']
 * @returns {object}
 */
export function loadBooklistFixture (variant = 'anonymous') {
  const fixtureUrl = new URL('../../fixture/booklist-' + variant + '.json', import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'))
}

/**
 * Load the committed bookcard DOM extraction fixture.
 * This fixture contains real book data from a public Z-Library booklist detail page.
 *
 * @param {string} [variant='101-books']
 * @returns {object}
 */
export function loadBookcardFixture (variant = '101-books') {
  const fixtureUrl = new URL('../../fixture/bookcard-' + variant + '.json', import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'))
}

function getFixtureList (fixture, probeName) {
  const probe = fixture && fixture.results && fixture.results[probeName]
  const response = probe && probe.response
  return Array.isArray(response && response.list) ? response.list : []
}

/**
 * Derive booklist rows from the saved API fixture.
 *
 * This keeps tests fixture-backed while still allowing explicit bookCount
 * overrides for scenarios that need a different count.
 *
 * @param {object} [fixture]
 * @param {object} [opts]
 * @param {number} [opts.count=1]
 * @param {number} [opts.bookCount=0]
 * @param {string} [opts.createdAt='2024-01-01']
 * @returns {Array<object>}
 */
export function makeFixtureBooklists (fixture = loadBooklistFixture(), opts = {}) {
  const { count = 1, bookCount = 0, createdAt = '2024-01-01' } = opts
  return getFixtureList(fixture, 'api-current-user').slice(0, count).map(function (item) {
    return {
      id: item.id,
      title: item.title,
      bookCount,
      createdAt
    }
  })
}

/**
 * Derive book rows from the saved bookcard DOM extraction fixture.
 *
 * The bookcard fixture is a real snapshot of a public booklist detail page,
 * captured by doctor-booklist --save-fixture. This replaces the old synthetic
 * generation that depended on the api-book-id-list probe (which was removed
 * because the endpoint is broken and returns cross-booklist data).
 *
 * @param {object} [fixture]  -  kept for backward compatibility, not used for book data
 * @param {object} [opts]
 * @param {number} [opts.count=1]
 * @param {string} [opts.origin='https://z-lib.gl']
 * @returns {Array<object>}
 */
export function makeFixtureBookRows (fixture = loadBooklistFixture(), opts = {}) {
  const { count = 1, origin = 'https://z-lib.gl' } = opts
  // Load real DOM extraction fixture for book data instead of synthetic generation.
  // The bookcard fixture is a real snapshot of a public booklist detail page,
  // captured by doctor-booklist --save-fixture.
  const bookcardFixture = loadBookcardFixture()
  const rows = (bookcardFixture && bookcardFixture.results && bookcardFixture.results['bookcard-rows'] && bookcardFixture.results['bookcard-rows'].data) || []

  if (rows.length === 0) return []

  return rows.slice(0, count).map(function (item) {
    const qr = item.qualityRating
    return {
      bookId: item.bookId,
      title: item.title || '',
      author: item.author || '',
      year: item.year || String(2020),
      language: item.language || '',
      extension: item.extension || '',
      size: item.size || '',
      url: item.url_path ? origin + item.url_path : '',
      publisher: item.publisher || '',
      isbn: item.isbn || '',
      qualityRating: qr === null || qr === undefined ? '' : qr,
      formatQualityRating: item.formatQualityRating !== undefined ? item.formatQualityRating : null,
      series: item.series || '',
      categories: item.categories || '',
      pages: item.pages || '',
      volume: item.volume || '',
      description: item.description || '',
      md5: item.md5 || '',
      downloadUrl: '',
      readlistBookId: item.readlistBookId || ''
    }
  })
}

/**
 * Build the detail-page evaluate call sequence for export tests from
 * fixture-derived book rows.
 *
 * @param {Array<object>} rows
 * @param {object} [opts]
 * @param {string} [opts.origin='https://z-lib.gl']
 * @returns {Array<unknown>}
 */
export function makeFixtureDetailEvals (rows, opts = {}) {
  const { origin = 'https://z-lib.gl' } = opts
  return rows.flatMap(function (row) {
    return [
      origin + '/book/' + row.bookId, // assertSameOriginNotLoginWall
      row.title || '',                // extractBookTitle
      row.author || '',               // extractBookAuthor
      row.language || '',             // extractBookLanguage
      row.qualityRating || '',        // extractBookFormatQualityRating
      JSON.stringify({                 // extractBookCardAttributes
        bookId: String(row.bookId),
        title: row.title || '',
        author: row.author || '',
        year: row.year || '',
        publisher: row.publisher || '',
        series: row.series || '',
        isbn: row.isbn || '',
        md5: row.md5 || ''
      }),
      JSON.stringify({                 // extractBookDetailAttributes
        categories: row.categories || '',
        pages: row.pages || '',
        isbn10: (row.isbn || '').replace(/[^0-9]/g, '').slice(-10),
        isbn13: row.isbn || '',
        volume: row.volume || '',
        description: row.description || '',
        series: row.series || '',
        publisher: row.publisher || ''
      }),
      JSON.stringify({ url: row.downloadUrl || '/dl/' + row.bookId + '/book.pdf' })
    ]
  })
}

/**
 * Create a page mock for booklist-add command tests.
 *
 * Supports three flows: --query, --current-page, and --book-id (singleBook).
 * The singleBook option activates the --book-id flow which uses
 * navigateAndExtractBookId instead of submitSearchQuery + extractSearchResults.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {Array<object>} [opts.searchResults]  -  search results from extractSearchResults
 * @param {Array<object>} [opts.existingMappings]  -  existing book-id-list mappings for dedup
 * @param {Array<object>} [opts.addResponses]  -  per-book addBookToBooklist return values
 * @param {boolean} [opts.hasQuery=true]  -  whether --query flow is used
 * @param {string} [opts.origin='https://z-lib.gl']  -  mock window.location.origin for --query flow
 * @param {string} [opts.href='https://z-lib.gl/s/python']  -  mock window.location.href for --query flow
 * @param {object} [opts.singleBook]  -  activates --book-id flow (mutually exclusive with hasQuery)
 * @param {string} [opts.singleBook.origin]  -  if set, window.location.origin is evaluated before navigation
 * @param {string} opts.singleBook.extractedBookId  -  navigateAndExtractBookId result (plain string)
 * @param {Array<object>} [opts.singleBook.existingMappings]  -  existing mappings for dedup (defaults to opts.existingMappings)
 * @param {object} [opts.singleBook.addResult]  -  addBookToBooklist API result (omit to skip add call, e.g. for duplicate)
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistAddPage (opts = {}) {
  const {
    booklists = [],
    searchResults = [],
    existingMappings = [],
    addResponses = [],
    hasQuery = true,
    singleBook,
    origin = 'https://z-lib.gl',
    href = 'https://z-lib.gl/s/python'
  } = opts
  const evaluateOrder = [
    JSON.stringify(booklists) // resolveBooklistByNameOrThrow → getBooklists
  ]
  if (singleBook) {
    // --book-id flow: navigateAndExtractBookId → addBookToBooklist
    // NOTE: getBookIdList dedup removed  -  API returns cross-booklist data
    const urlOrigin = singleBook.origin || origin // URL resolution origin for page.goto (line 216)

    if (singleBook.origin) {
      evaluateOrder.push(singleBook.origin) // window.location.origin  -  origin check (line 210)
    }
    // navigateToBookSelector always evaluates window.location.origin for URL resolution (line 216):
    //   new URL(targetPath, pageOrigin).href
    evaluateOrder.push(urlOrigin)
    evaluateOrder.push(singleBook.extractedBookId) // extractCurrentBookId (plain evaluate, NOT JSON.stringify)
    if (singleBook.addResult) {
      evaluateOrder.push(JSON.stringify(singleBook.addResult)) // addBookToBooklist
    }
  } else {
    // --query or --current-page flow
    if (hasQuery) {
      evaluateOrder.push(origin) // getCurrentHttpOrigin
      evaluateOrder.push(href) // assertSameOriginNotLoginWall
    }
    evaluateOrder.push(JSON.stringify(searchResults)) // extractSearchResults
    // NOTE: getBookIdList dedup removed  -  API returns cross-booklist data
    // Books are added directly; server handles dedup.
    for (const r of addResponses) {
      evaluateOrder.push(JSON.stringify(r)) // addBookToBooklist × N
    }
  }
  return createPageMock(evaluateOrder)
}

/**
 * Create a page mock for booklist-show command tests.
 *
 * The show command now uses readBooklistSnapshot() which internally:
 *   1. discoverBooklistEntry → getBooklists (API)
 *   2. tryEnrichBooklistInfo → getBooklistInfo (API)
 *   3. window.location.origin capture (kernel, fixed evaluate position)
 *   4. getBooklistBooks internal:
 *      - getCurrentHttpOrigin → window.location.origin
 *      - page.goto(searchUrl) → assertSameOriginNotLoginWall
 *      - href extraction
 *      - page.goto(detailUrl) → assertSameOriginNotLoginWall
 *      - DOM book row extraction (ready-retry)
 *      - (optional) clickBooklistLoadMore (pagination, only if books < expectedCount)
 *
 * NOTE: The kernel origin capture is BEFORE getBooklistBooks to ensure fixed
 * evaluate position regardless of pagination branching inside getBooklistBooks.
 *
 * Fixture-based BDD: committed API fixtures are the canonical test source.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {object} [opts.infoResult]  -  getBooklistInfo API result
 * @param {Array<object>} [opts.books]  -  books returned by getBooklistBooks
 * @param {string} [opts.origin='https://z-lib.gl']  -  mock window.location.origin
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistShowPage (opts = {}) {
  const { booklists = [], infoResult = {}, books = [], origin = 'https://z-lib.gl' } = opts

  const searchUrl = origin + '/booklists/my?searchQuery=test'
  const detailUrl = origin + '/booklist/1/hash/list.html'

  const evals = [
    JSON.stringify(booklists),  // 1: discover → getBooklists (API)
    JSON.stringify(infoResult), // 2: tryEnrich → getBooklistInfo (API)
    origin,                     // 3: kernel origin capture (FIXED position!)
    origin,                     // 4: getBooklistBooks → getCurrentHttpOrigin
    '/booklist/1/hash/list.html', // 5: findBooklistDetailHref extraction (runs before wall check)
    searchUrl,                  // 6: assertSameOriginNotLoginWall (search)
    detailUrl,                  // 7: assertSameOriginNotLoginWall (detail)
    JSON.stringify(books),      // 8: DOM book row extraction (ready-retry)
    // NOTE: clickBooklistLoadMore is NOT included — when pagination is
    // skipped (early return), the mock would leave an unconsumed value;
    // when pagination runs, evaluate falls back to undefined which is
    // also falsy and causes the same loop break.
  ]

  return createPageMock(evals)
}

/**
 * Create a page mock for booklist-create command tests.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {object|null} [opts.createResult]  -  createBooklist API result (null = no creation)
 * @param {boolean} [opts.hasQuery]  -  whether --query flow is used
 * @param {Array<object>} [opts.searchResults]  -  search results for --query
 * @param {Array<object>} [opts.addResponses]  -  per-book add responses for --query
 * @param {string} [opts.origin='https://z-lib.gl']  -  mock window.location.origin for --query flow
 * @param {string} [opts.href='https://z-lib.gl/s/python']  -  mock window.location.href for --query flow
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistCreatePage (opts = {}) {
  const { booklists = [], createResult = null, hasQuery = false, searchResults = [], addResponses = [], origin = 'https://z-lib.gl', href = 'https://z-lib.gl/s/python' } = opts
  const evals = [JSON.stringify(booklists)]
  if (createResult !== null) {
    evals.push(JSON.stringify(createResult))
  }
  if (hasQuery) {
    evals.push(origin) // getCurrentHttpOrigin
    evals.push(href) // assertSameOriginNotLoginWall
    evals.push(JSON.stringify(searchResults))
    for (const r of addResponses) {
      evals.push(JSON.stringify(r))
    }
  }
  return createPageMock(evals)
}

/**
 * Create a page mock for booklist-list command tests.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistListPage (opts = {}) {
  const { booklists = [] } = opts
  return createPageMock([
    JSON.stringify(booklists) // getBooklists
  ])
}

/**
 * Create a page mock for booklist-delete command tests.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {object} [opts.deleteResult]  -  deleteBooklist API result
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistDeletePage (opts = {}) {
  const { booklists = [], deleteResult = { success: true } } = opts
  return createPageMock([
    JSON.stringify(booklists), // resolveBooklistByNameOrThrow → getBooklists
    JSON.stringify(deleteResult) // deleteBooklist
  ])
}

/**
 * Create a page mock for booklist-manage command tests.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {string} [opts.operation]  -  'add-book-id', 'delete-book-id', or 'append-query'
 * @param {Array<object>} [opts.mappings]  -  book-id-list mappings (for add-book-id already-in-list fallback)
 * @param {object} [opts.addResult]  -  addBookToBooklist API result (for add-book-id)
 * @param {string|null} [opts.readlistBookIdFromDom]  -  DOM scan result for delete-book-id (readlistBookId string or null)
 * @param {object} [opts.removeResult]  -  removeBookFromBooklist API result (for delete-book-id, when book found)
 * @param {Array<object>} [opts.searchResults]  -  search results (for append-query)
 * @param {Array<object>} [opts.addResponses]  -  per-book add responses (for append-query)
 * @param {string} [opts.origin='https://z-lib.gl']  -  mock window.location.origin for append-query flow
 * @param {string} [opts.href='https://z-lib.gl/s/python']  -  mock window.location.href for append-query flow
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistManagePage (opts = {}) {
  const { booklists = [], operation, mappings = [], addResult = {}, readlistBookIdFromDom = null, removeResult = {}, searchResults = [], addResponses = [], origin = 'https://z-lib.gl', href = 'https://z-lib.gl/s/python' } = opts
  const evals = [
    JSON.stringify(booklists) // resolveBooklistByNameOrThrow → getBooklists
  ]

  if (operation === 'add-book-id') {
    evals.push(JSON.stringify(addResult)) // addBookToBooklist
    evals.push(JSON.stringify(mappings)) // getBookIdList (for already_in_booklist fallback)
  } else if (operation === 'delete-book-id') {
    // New delete flow: resolve readlistBookId from DOM (z-bookcard booklistsindex)
    // Eval order: [booklists, origin, detailHref, searchFinalUrl, detailFinalUrl, domScanResult, removeResult]
    evals.push(origin) // getCurrentHttpOrigin in resolveReadlistBookIdFromDom
    evals.push('/booklist/1/hash/list.html') // findBooklistDetailHref
    evals.push(origin + '/booklists/my?searchQuery=My%20List') // assertSameOriginNotLoginWall after search navigation
    evals.push('https://z-lib.gl/booklist/1/hash/list.html') // assertSameOriginNotLoginWall
    // DOM scan result — the scanner evaluate returns JSON {readlistBookId, cardCount}
    evals.push(JSON.stringify({
      readlistBookId: readlistBookIdFromDom != null ? String(readlistBookIdFromDom) : null,
      cardCount: readlistBookIdFromDom != null ? 1 : 0,
    }))
    if (readlistBookIdFromDom != null) {
      evals.push(JSON.stringify(removeResult)) // removeBookFromBooklist
    }
  } else if (operation === 'append-query') {
    // NOTE: getBookIdList dedup removed  -  API returns cross-booklist data
    evals.push(origin) // getCurrentHttpOrigin
    evals.push(href) // assertSameOriginNotLoginWall
    evals.push(JSON.stringify(searchResults))
    for (const r of addResponses) {
      evals.push(JSON.stringify(r)) // addBookToBooklist × N
    }
  }

  return createPageMock(evals)
}

/**
 * Create a page mock for booklist-export command tests.
 *
 * The export command now uses readBooklistSnapshot() which internally:
 *   1. discoverBooklistEntry → getBooklists (API)
 *   2. tryEnrichBooklistInfo → getBooklistInfo (API)
 *   3. window.location.origin capture (kernel, fixed position)
 *   4. getBooklistBooks (DOM extraction with pagination)
 *
 * (Optional --detail) appended after main snapshot flow.
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {object} [opts.infoResult]  -  getBooklistInfo API result for enrichment
 * @param {Array<object>} [opts.books]  -  books returned by getBooklistBooks
 * @param {string} [opts.origin='https://z-lib.gl']  -  mock window.location.origin
 * @param {Array<string>} [opts.detailExtraEvals]  -  additional evaluate returns for --detail flow
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistExportPage (opts = {}) {
  const { booklists = [], infoResult = {}, books = [], origin = 'https://z-lib.gl', detailExtraEvals = [] } = opts

  // Auto-derive infoResult from booklists when not explicitly provided
  const hasExplicitInfo = Object.keys(infoResult).length > 0 || infoResult.error !== undefined
  const effectiveInfoResult = hasExplicitInfo ? infoResult : (booklists.length > 0 ? {
    id: booklists[0].id,
    title: booklists[0].title,
    bookCount: booklists[0].bookCount,
    createdAt: booklists[0].createdAt,
  } : {})

  // Build mock book row data matching getBooklistBooks DOM extraction shape
  const bookRowData = books.map(function (b) {
    return {
      bookId: b.bookId,
      url: b.url,
      title: b.title,
      author: b.author,
      readlistBookId: b.readlistBookId || '',
      language: b.language || '',
      extension: b.extension || '',
      size: b.size || '',
      formatQualityRating: b.formatQualityRating || null,
      qualityRating: b.qualityRating || null,
      publisher: b.publisher || '',
      isbn: b.isbn || '',
      md5: b.md5 || '',
      series: b.series || '',
      categories: b.categories || ''
    }
  })

  // Eval sequence using readBooklistSnapshot:
  const searchUrl = origin + '/booklists/my?searchQuery=test'
  const detailUrl = origin + '/booklist/1/hash/list.html'
  const evals = [
    JSON.stringify(booklists),        // 1: discover → getBooklists (API)
    JSON.stringify(effectiveInfoResult), // 2: tryEnrich → getBooklistInfo (API)
    origin,                           // 3: kernel origin capture (FIXED!)
    origin,                           // 4: getBooklistBooks → getCurrentHttpOrigin
    '/booklist/1/hash/list.html',     // 5: findBooklistDetailHref extraction (runs before wall check)
    searchUrl,                        // 6: assertSameOriginNotLoginWall (search)
    detailUrl,                        // 7: assertSameOriginNotLoginWall (detail)
    JSON.stringify(bookRowData),      // 8: DOM book row extraction
    // NOTE: clickBooklistLoadMore not included (falls back to undefined if pagination runs)
  ]

  // Append --detail extra evaluate calls (if any)
  if (detailExtraEvals.length > 0) {
    evals.push(...detailExtraEvals)
  }

  return createPageMock(evals)
}

/**
 * Create a page mock for booklist-import command tests.
 *
 * The import command flow:
 * 1. resolveBooklistByNameOrThrow → getBooklists
 * 2. getBookIdList (for dedup)
 * 3. addBooksToBooklist → addBookToBooklist × N
 *
 * @param {object} [opts]
 * @param {Array<object>} [opts.booklists]  -  existing booklists list
 * @param {Array<object>} [opts.existingMappings]  -  existing book-id-list mappings for dedup
 * @param {Array<object>} [opts.addResponses]  -  per-book addBookToBooklist return values
 * @returns {ReturnType<typeof createPageMock>}
 */
export function createBooklistImportPage (opts = {}) {
  const { booklists = [], existingMappings = [], addResponses = [] } = opts
  const evals = [
    JSON.stringify(booklists), // resolveBooklistByNameOrThrow → getBooklists
    JSON.stringify(existingMappings) // getBookIdList
  ]
  for (const r of addResponses) {
    evals.push(JSON.stringify(r)) // addBookToBooklist × N
  }
  return createPageMock(evals)
}
