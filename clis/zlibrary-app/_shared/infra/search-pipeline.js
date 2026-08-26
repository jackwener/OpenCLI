/**
 * Pure search/filter pipeline module for Z-Library Desktop.
 *
 * Contains filter functions and pagination helper extracted from search.js.
 * This module has NO command registration side-effects  -  it is a pure
 * dependency for both search.js and _shared/infra/booklist-search.js.
 *
 * Imports DOM extractors and constants directly from zlibrary/dom.js.
 *
 * Imported by:
 *   - search.js (re-exports these functions for backward compat)
 *   - _shared/infra/booklist-search.js (uses directly)
 */
import { extractSearchResults, LANGUAGE_BY_CODE } from '../../../zlibrary/dom.js'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { assertSameOriginNotLoginWall } from './url-boundary.js'

// ---------------------------------------------------------------------------
// URL filter query string builder
// ---------------------------------------------------------------------------

/**
 * Build a URL query string from filter options for Z-Library Desktop search.
 *
 * Converts filter flags to URL params recognized by the Desktop app:
 *   ?languages[]=japanese&extensions[]=PDF&selected_content_types[]=book&yearFrom=2020&yearTo=2024
 *
 * Returns an empty string when no filters are active, so callers can safely
 * append the result without checking for emptiness.
 *
 * @param {string[]} langCodes  -  ISO language codes (e.g. ['ja', 'en'])
 * @param {string[]} extensions  -  lower-case file extensions (e.g. ['pdf', 'epub'])
 * @param {string[]} contentTypes  -  content types (e.g. ['book', 'article'])
 * @param {number|null} yearFrom
 * @param {number|null} yearTo
 * @param {Map} languageByCode  -  LANGUAGE_BY_CODE map (code → title-case name)
 * @returns {string}  -  query string with leading `?`, or empty string
 */
export function buildFilterQueryString (langCodes, extensions, contentTypes, yearFrom, yearTo, languageByCode, exactMatching) {
  const params = []

  for (let i = 0; i < (langCodes || []).length; i++) {
    const name = languageByCode.get(langCodes[i])
    if (name) {
      params.push('languages[]=' + encodeURIComponent(name.toLowerCase()))
    }
  }

  for (let i = 0; i < (extensions || []).length; i++) {
    params.push('extensions[]=' + encodeURIComponent(extensions[i].toUpperCase()))
  }

  for (let i = 0; i < (contentTypes || []).length; i++) {
    params.push('selected_content_types[]=' + encodeURIComponent(contentTypes[i].toLowerCase()))
  }

  if (yearFrom != null) params.push('yearFrom=' + yearFrom)
  if (yearTo != null) params.push('yearTo=' + yearTo)
  if (exactMatching) params.push('e=1')

  return params.length ? '?' + params.join('&') : ''
}

/**
 * Filter results by regex patterns for title/author/publisher.
 *
 * Uses case-insensitive + unicode regex (`ui`) and partial matching.
 * Throws ArgumentError on invalid regex input.
 *
 * @param {Array<{title?: string, author?: string, publisher?: string}>} results
 * @param {string|null|undefined} regexTitle
 * @param {string|null|undefined} regexAuthor
 * @param {string|null|undefined} regexPublisher
 * @returns {Array}
 */
export function filterByRegex (results, regexTitle, regexAuthor, regexPublisher) {
  const titlePattern = compileOptionalRegex(regexTitle, 'filter-regex-title')
  const authorPattern = compileOptionalRegex(regexAuthor, 'filter-regex-author')
  const publisherPattern = compileOptionalRegex(regexPublisher, 'filter-regex-publisher')

  if (!titlePattern && !authorPattern && !publisherPattern) return results

  return results.filter(function (row) {
    if (titlePattern && !titlePattern.test(String(row.title || ''))) return false
    if (authorPattern && !authorPattern.test(String(row.author || ''))) return false
    if (publisherPattern && !publisherPattern.test(String(row.publisher || ''))) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Post‑filter helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Filter results by language (ISO codes mapped to full names).
 * @param {Array<{language: string}>} results
 * @param {string[]} languages  -  ISO codes (e.g. ['ja', 'en'])
 * @returns {Array}
 */
export function filterByLanguage (results, languages) {
  if (!languages || !languages.length) return results
  const languageNames = languages
    .map(function (code) { return LANGUAGE_BY_CODE.get(code) })
    .filter(Boolean)
  if (!languageNames.length) return []
  const lowerNames = languageNames.map(function (n) { return n.toLowerCase() })
  return results.filter(function (r) {
    return lowerNames.includes((r.language || '').toLowerCase())
  })
}

/**
 * Filter results by file extension.
 * @param {Array<{extension: string}>} results
 * @param {string[]} extensions  -  e.g. ['pdf', 'epub']
 * @returns {Array}
 */
export function filterByExtension (results, extensions) {
  if (!extensions || !extensions.length) return results
  const normalizedExtensions = extensions.map(function (e) { return e.toLowerCase() })
  return results.filter(function (r) {
    return normalizedExtensions.includes((r.extension || '').toLowerCase())
  })
}

/**
 * Filter out fake/invalid entries where the title is an "MD5:..." placeholder.
 *
 * The Z-Library search sometimes returns garbage records when the search query
 * (especially "MD5:<hash>") matches text in the title/author fields of unrelated
 * entries. These records have title="MD5:<hash>" and are indistinguishable from
 * real records except by their nonsensical title.
 *
 * @param {Array<{title?: string}>} results
 * @returns {Array}
 */
export function filterByFakeEntries (results) {
  return results.filter(function (r) {
    var title = String(r.title || '')
    return title.substring(0, 4).toLowerCase() !== 'md5:'
  })
}

/**
 * Filter results by full language display names (case-insensitive).
 *
 * Unlike filterByLanguage (which takes ISO codes), this takes display names
 * like "English", "Japanese". Used by --filter-lang-names across commands.
 *
 * @param {Array<{language: string}>} results
 * @param {string[]} names  -  full display names (e.g. ['English', 'Japanese'])
 * @returns {Array}
 */
export function filterByLanguageNames (results, names) {
  if (!names || !names.length) return results
  const lowerNames = names.map(function (n) { return n.toLowerCase() })
  return results.filter(function (r) {
    return lowerNames.includes((r.language || '').toLowerCase())
  })
}

/**
 * Filter results by content type.
 * @param {Array<{contentType: string}>} results
 * @param {string[]} contentTypes  -  e.g. ['book', 'article']
 * @returns {Array}
 */
export function filterByContentType (results, contentTypes) {
  if (!contentTypes || !contentTypes.length) return results
  const normalizedContentTypes = contentTypes.map(function (t) { return t.toLowerCase() })
  return results.filter(function (r) {
    return normalizedContentTypes.includes((r.contentType || '').toLowerCase())
  })
}

/**
 * Filter results by publication year range (inclusive).
 * @param {Array<{year: string}>} results
 * @param {number|null|undefined} from
 * @param {number|null|undefined} to
 * @returns {Array}
 */
export function filterByYearRange (results, from, to) {
  if (from == null && to == null) return results
  return results.filter(function (result) {
    const year = parseInt(result.year, 10)
    if (isNaN(year)) return true
    if (from != null && year < from) return false
    if (to != null && year > to) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/**
 * Fetch results from all available pages up to a safety limit.
 *
 * When `origin` is provided, validates same-origin and login-wall after each
 * page navigation. This prevents silent data leaks from cross-origin redirects
 * and detects login walls during pagination.
 *
 * When `filterQueryString` is provided (a string starting with `?`), it is
 * appended to each pagination URL before the `&page=N` parameter. This lets
 * URL-based filtering work across paginated pages.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} query
 * @param {number} [maxPages=20]
 * @param {string} [origin] - Validated origin for same-origin checks (from getCurrentHttpOrigin)
 * @param {string} [filterQueryString] - Pre-built filter query string (starting with `?`), or empty
 * @returns {Promise<Array>}
 */
export async function fetchAllPages (page, query, maxPages, origin, filterQueryString) {
  if (maxPages == null) maxPages = 20
  let allResults = []
  const seenIds = new Set()

  for (let n = 1; n <= maxPages; n++) {
    const pageParam = filterQueryString ? '&page=' + n : '?page=' + n
    const path = buildSearchPath(query, filterQueryString) + pageParam
    const url = (origin || '') + path
    await page.goto(url, {
      waitUntil: 'load',
      settleMs: 3000
    })

    // When origin is provided, validate trust boundary after each navigation.
    // A redirect during pagination could land on a different origin or login wall.
    if (origin) {
      await assertSameOriginNotLoginWall(page, new URL(origin), 'zlibrary-app search')
    }

    const results = await extractSearchResults(page, 50)
    if (!results.length) break

    const newResults = results.filter(function (row) {
      if (row == null || row.id == null) return false
      const id = String(row.id)
      if (seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
    if (!newResults.length) break

    allResults = allResults.concat(newResults.map(function (r, i) {
      return { ...r, rank: allResults.length + i + 1 }
    }))

    if (results.length < 50) break
  }

  return allResults
}

// ---------------------------------------------------------------------------
// Array / validation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a potentially multi‑value CLI arg into a clean string array.
 */
export function toArray (value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  return String(value).split(',').map(function (s) { return s.trim() }).filter(Boolean)
}

/**
 * Validate known values, throwing ArgumentError for unknowns.
 */
export function assertKnownValues (values, isKnown, argName, examples) {
  const unknown = values.filter(function (value) { return !isKnown(value) })
  if (!unknown.length) return
  throw new ArgumentError(
    '--' + argName + ' has unsupported value(s): ' + unknown.join(', '),
    'Supported values include: ' + examples
  )
}

function compileOptionalRegex (pattern, argName) {
  if (pattern == null) return null
  const text = String(pattern)
  if (!text) return null
  try {
    return new RegExp(text, 'ui')
  } catch (error) {
    throw new ArgumentError(
      '--' + argName + ' is not a valid regular expression: ' + text,
      String(error && error.message ? error.message : error)
    )
  }
}

// ---------------------------------------------------------------------------
// Shared search navigation helpers
// ---------------------------------------------------------------------------

/**
 * Build search relative path: /s/<encoded-query>[?filterQs]
 * @param {string} query
 * @param {string} [filterQueryString='']
 * @returns {string}
 */
export function buildSearchPath (query, filterQueryString = '') {
  return '/s/' + encodeURIComponent(query) + (filterQueryString || '')
}

/**
 * Build full search URL
 * @param {string} origin
 * @param {string} query
 * @param {string} [filterQueryString='']
 * @returns {string}
 */
export function buildSearchUrl (origin, query, filterQueryString = '') {
  return origin + buildSearchPath(query, filterQueryString)
}

function assertStartOrigin (startOrigin, contextName) {
  const commandName = contextName || 'zlibrary-app search'
  if (!startOrigin || typeof startOrigin !== 'object' || typeof startOrigin.origin !== 'string' || !startOrigin.origin.trim()) {
    throw new ArgumentError(
      commandName + ' search pipeline requires startOrigin object with origin string',
      'Pass getCurrentHttpOrigin(page) result or { origin: "https://example.org" }.'
    )
  }

  return { origin: startOrigin.origin.trim().replace(/\/+$/, '') }
}

/**
 * Navigate to search results page with wait + same-origin check
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{origin: string}} startOrigin
 * @param {string} query
 * @param {Object} [opts={}]
 * @param {string} [opts.filterQs='']
 * @returns {Promise<{searchPath: string, searchUrl: string}>}
 */
export async function navigateToSearchResultsPage (page, startOrigin, query, opts = {}) {
  const origin = assertStartOrigin(startOrigin, opts.contextName)
  const searchUrl = buildSearchUrl(origin.origin, query, opts.filterQs)
  await page.goto(searchUrl, { waitUntil: 'load', settleMs: opts.settleMs || 2000 })
  await page.wait(1500) // wait for z-bookcard render
  await assertSameOriginNotLoginWall(page, origin, opts.contextName || 'zlibrary-app')
  return { searchPath: buildSearchPath(query, opts.filterQs), searchUrl }
}

/**
 * Navigate + extract results in one call
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{origin: string}} startOrigin
 * @param {string} query
 * @param {Object} [opts={}]
 * @param {string} [opts.filterQs='']
 * @param {number} [opts.limit=100]
 * @returns {Promise<{searchPath: string, searchUrl: string, results: Array}>}
 */
export async function collectSearchResultsPage (page, startOrigin, query, opts = {}) {
  const { searchPath, searchUrl } = await navigateToSearchResultsPage(page, startOrigin, query, opts)
  const results = await extractSearchResults(page, opts.limit || 100)
  return { searchPath, searchUrl, results }
}
