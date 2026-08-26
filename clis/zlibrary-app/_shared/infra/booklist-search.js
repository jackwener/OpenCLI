/**
 * Shared search/filter pipeline for booklist commands.
 *
 * Encapsulates the parse-filters → search → apply-filters lifecycle
 * that is identical across booklist-create, booklist-add (--query path),
 * and booklist-manage (--append-query path).
 *
 * See naming convention (opencli-cefr-b2plus-pattern.md §4) for the contract.
 * CEFR B2+ = upper-intermediate English vocabulary level.
 *
 * All filter functions are imported from the pure search-pipeline.js module
 * (NOT from search.js, which has command registration side-effects).
 */
import { ArgumentError } from '@jackwener/opencli/errors'
import { requireNonEmptyRows } from '../../../_shared/search-adapter.js'
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './url-boundary.js'
import { extractSearchResults, validateLanguage, validateLanguageName, validateExtension, LANGUAGE_BY_CODE } from '../../../zlibrary/dom.js'
import {
  filterByRegex,
  fetchAllPages,
  buildFilterQueryString,
  toArray
} from './search-pipeline.js'

/**
 * @typedef {Object} BooklistSearchOptions
 * @property {string[]} langCodes
 * @property {string[]} langNames
 * @property {string[]} extensions
 * @property {number|null} filterYearFrom
 * @property {number|null} filterYearTo
 * @property {number|null} limit
 * @property {boolean} unlimited
 * @property {boolean} exactMatching
 * @property {string} regexTitle
 * @property {string} regexAuthor
 * @property {string} regexPublisher
 */

// ---------------------------------------------------------------------------
// Filter validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate a --filter-year-from / --filter-year-to CLI arg.
 * @param {object} kwargs  -  CLI kwargs object
 * @param {string} argName  -  'filter-year-from' or 'filter-year-to'
 * @param {string} commandName  -  for error messages
 * @returns {number|null}
 * @throws {ArgumentError}
 */
function parseOptionalFilterYear (kwargs, argName, commandName) {
  const rawValue = kwargs[argName]
  if (rawValue == null) return null

  const year = Number(rawValue)
  if (!Number.isInteger(year) || year < 0) {
    throw new ArgumentError(
      'booklist-' + commandName + ' --' + argName + ' must be a non-negative integer year',
      'Example: opencli zlibrary-app booklist-' + commandName + ' --' + argName + ' 2020'
    )
  }
  return year
}

/**
 * Parse and validate booklist search filter args from CLI kwargs.
 *
 * Throws ArgumentError for invalid filter values, out-of-range --limit,
 * or --limit/--unlimited mutual exclusion. Returns a clean options object
 * for downstream use.
 *
 * @param {object} kwargs  -  CLI kwargs object
 * @param {string} commandName  -  command name for error messages (e.g. 'create')
 * @returns {BooklistSearchOptions}
 */
export function parseBooklistSearchOptions (kwargs, commandName) {
  const langCodes = toArray(kwargs['filter-lang-codes'])
  const langNames = toArray(kwargs['filter-lang-names'])
  const extensions = toArray(kwargs['filter-ext'])

  if (langCodes.length) {
    assertKnownValues(langCodes, validateLanguage, 'filter-lang-codes', 'en, ja, zh, fr, de, etc.', commandName)
  }
  if (langNames.length) {
    assertKnownValues(langNames, validateLanguageName, 'filter-lang-names', 'English, Japanese, Chinese, French, German', commandName)
  }
  if (extensions.length) {
    assertKnownValues(extensions, validateExtension, 'filter-ext', 'pdf, epub, azw3, mobi', commandName)
  }

  // Validate --limit / --unlimited mutual exclusion
  if (kwargs.limit != null && kwargs.unlimited) {
    throw new ArgumentError('--limit and --unlimited are mutually exclusive')
  }

  // Validate --limit range  -  throw ArgumentError instead of silent clamp
  let limit
  if (kwargs.unlimited) {
    limit = null
  } else {
    const rawLimit = kwargs.limit != null ? Number(kwargs.limit) : 50
    if (!Number.isFinite(rawLimit) || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      throw new ArgumentError(
        'booklist-' + commandName + ' --limit must be an integer between 1 and 50',
        'Got: ' + rawLimit
      )
    }
    limit = rawLimit
  }

  // Validate --filter-year-from / --filter-year-to
  const filterYearFrom = parseOptionalFilterYear(kwargs, 'filter-year-from', commandName)
  const filterYearTo = parseOptionalFilterYear(kwargs, 'filter-year-to', commandName)
  const regexTitle = parseOptionalRegexFilter(kwargs['filter-regex-title'], 'filter-regex-title', commandName)
  const regexAuthor = parseOptionalRegexFilter(kwargs['filter-regex-author'], 'filter-regex-author', commandName)
  const regexPublisher = parseOptionalRegexFilter(kwargs['filter-regex-publisher'], 'filter-regex-publisher', commandName)

  if (filterYearFrom != null && filterYearTo != null && filterYearFrom > filterYearTo) {
    throw new ArgumentError(
      '--filter-year-from (' + filterYearFrom + ') cannot be greater than --filter-year-to (' + filterYearTo + ')'
    )
  }

  return {
    langCodes,
    langNames,
    extensions,
    filterYearFrom,
    filterYearTo,
    limit,
    unlimited: !!kwargs.unlimited,
    exactMatching: !!kwargs['filter-exact-matching'],
    regexTitle,
    regexAuthor,
    regexPublisher
  }
}

// ---------------------------------------------------------------------------
// Search + filter pipeline
// ---------------------------------------------------------------------------

/**
 * Execute a search and apply language/extension filters.
 *
 * Supports both single-page (up to options.limit) and multi-page
 * (options.limit == null, up to ~1000) fetching.
 *
 * Throws CommandExecutionError (via requireNonEmptyRows) when the
 * result set is empty.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} query  -  search query
 * @param {BooklistSearchOptions} options
 * @param {string} commandName  -  for error messages
 * @returns {Promise<Array>}
 */
export async function collectBooksForBooklist (page, query, options, commandName) {
  let books

  if (options.limit == null) {
    // Unlimited mode: fetch all pages
    // Get the current page origin via getCurrentHttpOrigin  -  validates http(s) protocol
    // and rejects file://, javascript:, etc. (per opencli-url-boundary spec).
    const origin = (await getCurrentHttpOrigin(page)).origin
    // Build filter query string so server-side pre-filtering works
    // (same pattern as search.js  -  otherwise JS post-filter yields fewer matches)
    const filterQs = buildFilterQueryString(
      options.langCodes, options.extensions, [],
      options.filterYearFrom, options.filterYearTo, LANGUAGE_BY_CODE, options.exactMatching
    )
    books = await fetchAllPages(page, query, 20, origin, filterQs)
  } else {
    // Single-page mode: page navigation and extract results
    const origin = (await getCurrentHttpOrigin(page)).origin
    const encoded = encodeURIComponent(query)
    const filterQs = buildFilterQueryString(
      options.langCodes, options.extensions, [],
      options.filterYearFrom, options.filterYearTo, LANGUAGE_BY_CODE, options.exactMatching
    )
    const searchPageUrl = origin + '/s/' + encoded + filterQs
    await page.goto(searchPageUrl, { waitUntil: 'load', settleMs: 2000 })
    await assertSameOriginNotLoginWall(page, new URL(origin), 'zlibrary-app booklist-' + commandName)
    books = await extractSearchResults(page, options.limit)
  }

  // Apply display filters
  books = applyBooklistSearchFilters(books, options)

  // Enforce non-empty result (throws CommandExecutionError)
  requireNonEmptyRows(
    books,
    'zlibrary-app booklist-' + commandName,
    'No books found. Try a different query or fewer filters.'
  )

  return books
}

// ---------------------------------------------------------------------------
// Shared filter chain helpers
// ---------------------------------------------------------------------------

const BOOKLIST_FILTERS = [
  // Only regex filters are applied as JS post-filters.
  // All other --filter-* flags (lang-codes, lang-names, ext, year-*, exact-matching)
  // are applied via URL params in buildFilterQueryString()  -  server-side only.
  {
    isActive: options => options.regexTitle || options.regexAuthor || options.regexPublisher,
    apply: (books, options) => filterByRegex(books, options.regexTitle, options.regexAuthor, options.regexPublisher)
  }
]

/**
 * Apply all active booklist search filters in declared order.
 * @param {Array} books
 * @param {BooklistSearchOptions} options
 * @returns {Array}
 */
export function applyBooklistSearchFilters (books, options) {
  return BOOKLIST_FILTERS.reduce(function (filtered, filter) {
    return filter.isActive(options) ? filter.apply(filtered, options) : filtered
  }, books)
}

/**
 * Check whether any search-only filter flags were passed in kwargs.
 * These flags only make sense when paired with --query or --append-query.
 *
 * @param {object} kwargs
 * @returns {boolean}
 */
export function hasBooklistSearchArgs (kwargs) {
  return [
    'filter-lang-codes',
    'filter-lang-names',
    'filter-ext',
    'filter-year-from',
    'filter-year-to',
    'filter-exact-matching',
    'filter-regex-title',
    'filter-regex-author',
    'filter-regex-publisher',
    'unlimited'
  ].some(function (name) {
    return kwargs[name] != null && kwargs[name] !== false
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertKnownValues (values, isKnown, argName, examples, commandName) {
  const unknown = values.filter(function (v) { return !isKnown(v) })
  if (!unknown.length) return
  throw new ArgumentError(
    'booklist-' + commandName + ' --' + argName + ' has unsupported value(s): ' + unknown.join(', '),
    'Supported values include: ' + examples
  )
}

function parseOptionalRegexFilter (value, argName, commandName) {
  if (value == null) return ''
  if (value === true) {
    throw new ArgumentError(
      'booklist-' + commandName + ' --' + argName + ' requires a string value',
      'Example: opencli zlibrary-app booklist-' + commandName + ' --' + argName + ' "算法|Python"'
    )
  }
  return String(value).trim()
}
