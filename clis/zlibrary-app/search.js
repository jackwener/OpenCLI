/**
 * Z-Library Desktop search command.
 *
 * Submits a search query in the Z-Library Desktop app via CDP.
 * Supports post‑filtering by language, extension, content type, and year range,
 * as well as multi‑page aggregation with --unlimited.
 *
 * Canonical filter flags: --filter-lang-codes, --filter-ext, --filter-content-type,
 * --filter-year-from, --filter-year-to.
 *
 * All CLI output columns use kebab-case naming (e.g., 'content-type', 'isbn-10').
 * Internal row objects use camelCase/underscore keys; normalizeOutputKeys() at the
 * output boundary converts them to kebab-case.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError, LoginWallError } from '@jackwener/opencli/errors'
import { requireNonEmptyRows } from '../_shared/search-adapter.js'
import { extractSearchResults, languageCodeByName, LANGUAGE_BY_CODE, validateLanguage, validateExtension, validateContentType } from '../zlibrary/dom.js'
import { enrichBookRowFromDetailPage } from './_shared/infra/book-detail.js'
import { normalizeOutputKeys, renderFilenameTemplate } from './_shared/infra/manifest-helpers.js'

import {
  filterByLanguage,
  filterByLanguageNames,
  filterByExtension,
  filterByContentType,
  filterByYearRange,
  filterByRegex,
  filterByFakeEntries,
  fetchAllPages,
  buildFilterQueryString,
  toArray,
  assertKnownValues,
  collectSearchResultsPage
} from './_shared/infra/search-pipeline.js'

import {
  getCurrentHttpOrigin,
  assertSameOriginNotLoginWall
} from './_shared/infra/url-boundary.js'

// Re-export filter/pagination helpers for backward compatibility
export {
  filterByLanguage,
  filterByLanguageNames,
  filterByExtension,
  filterByContentType,
  filterByYearRange,
  filterByRegex,
  filterByFakeEntries,
  fetchAllPages,
  buildFilterQueryString,
  toArray,
  assertKnownValues
}

/** Empty defaults for detail-enrichment columns (pages, isbn10/13, series, volume, categories, description, metaDescription). */
const EMPTY_DETAIL_FIELDS = {
  pages: '', isbn10: '', isbn13: '',
  series: '', volume: '', categories: '', description: '',
  metaDescription: ''
}

/** Build a row with normalized key names and optional filename. */
function buildRowWithFilename (row, filenameTemplate) {
  const normalized = Object.assign({}, row, EMPTY_DETAIL_FIELDS, {
    detail_error: null,
    'language-code': languageCodeByName(row.language || '')
  })
  if (filenameTemplate) {
    // Normalize all values to kebab-case for consistent template resolution.
    // templateValues uses the same key format as the final CLI output row,
    // so template keys (e.g. {format-quality-rating}, {language-code}) resolve
    // directly without TEMPLATE_ALIASES indirection.
    const templateValues = normalizeOutputKeys(Object.assign({}, normalized))
    normalized.filename = renderFilenameTemplate(filenameTemplate, templateValues)
  }
  return normalizeOutputKeys(normalized)
}

/**
 * All available filename template key names.
 * These are the search result columns that can be used in `--filename-template`.
 * Note: `bookId` is an alias for `{id}`. `md5` resolves to empty for search-only
 * results (use in download scenarios).
 */
const FILENAME_KEY_NAMES = [
  'bookId', 'id', 'title', 'author', 'year', 'language', 'language-code', 'extension',
  'content-type', 'quality-rating', 'format-quality-rating', 'publisher', 'isbn', 'md5'
]

/**
 * Extract MD5 hash from a search query of the form "MD5:<32-char-hex>".
 * Returns empty string for non-MD5 queries.
 * @param {string} query
 * @returns {string}
 */
function md5FromQuery (query) {
  const m = String(query || '').match(/^MD5:([a-f0-9]{32})$/i)
  return m ? m[1].toLowerCase() : ''
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseOptionalYear (value, argName) {
  if (value == null) return null
  const year = Number(value)
  if (!Number.isInteger(year)) {
    throw new ArgumentError(
      'zlibrary-app search --' + argName + ' must be an integer year',
      'Example: opencli zlibrary-app search python --' + argName + ' 2020'
    )
  }
  return year
}

/**
 * Parse filename template argument.
 * Throws ArgumentError when OpenCLI sets the boolean `true` on a `type: 'string'` flag
 * that was passed without a value (e.g. `--filename-template` alone).
 */
export function parseFilenameTemplate (value) {
  if (value === true) {
    throw new ArgumentError(
      'zlibrary-app search --filename-template requires a string value',
      'Provide a string value: --filename-template "{author} - {title}"'
    )
  }
  if (typeof value === 'string' && value) return value
  return ''
}

function parseOptionalRegexFilter (value, argName) {
  if (value == null) return ''
  if (value === true) {
    throw new ArgumentError(
      'zlibrary-app search --' + argName + ' requires a string value',
      'Provide a pattern: --' + argName + ' "算法|Python"'
    )
  }
  return String(value).trim()
}

/**
 * Parse and normalise search CLI options using only canonical flag names.
 * Old flags (--language, --extension, etc.) have been fully removed.
 */
function parseSearchOptions (kwargs) {
  const filterLangCodes = toArray(kwargs['filter-lang-codes'])
  const filterExt = toArray(kwargs['filter-ext'])
  const filterContentType = toArray(kwargs['filter-content-type'])
  const filterYearFrom = parseOptionalYear(kwargs['filter-year-from'], 'filter-year-from')
  const filterYearTo = parseOptionalYear(kwargs['filter-year-to'], 'filter-year-to')
  const filterRegexTitle = parseOptionalRegexFilter(kwargs['filter-regex-title'], 'filter-regex-title')
  const filterRegexAuthor = parseOptionalRegexFilter(kwargs['filter-regex-author'], 'filter-regex-author')
  const filterRegexPublisher = parseOptionalRegexFilter(kwargs['filter-regex-publisher'], 'filter-regex-publisher')

  assertKnownValues(filterLangCodes, validateLanguage, 'filter-lang-codes', 'en, ja, zh, fr, de, etc.')
  assertKnownValues(filterExt, validateExtension, 'filter-ext', 'pdf, epub, azw3, mobi')
  assertKnownValues(filterContentType, validateContentType, 'filter-content-type', 'book, article, magazine, thesis')
  if (filterYearFrom != null && filterYearTo != null && filterYearFrom > filterYearTo) {
    throw new ArgumentError(
      'zlibrary-app search --filter-year-from must be less than or equal to --filter-year-to',
      'Example: opencli zlibrary-app search python --filter-year-from 2020 --filter-year-to 2024'
    )
  }

  // Validate limit range — throw instead of silent clamp
  const rawLimit = kwargs.limit != null ? Number(kwargs.limit) : 50
  if (!Number.isFinite(rawLimit) || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    throw new ArgumentError(
      'zlibrary-app search --limit must be an integer between 1 and 50',
      'Got: ' + rawLimit
    )
  }

  const query = String(kwargs.query || '').trim()
  if (!query) {
    throw new ArgumentError(
      'zlibrary-app search requires a query argument and it must not be blank',
      'Example: opencli zlibrary-app search python'
    )
  }

  return {
    query,
    limit: rawLimit,
    filterLangCodes,
    filterExt,
    filterContentType,
    filterYearFrom,
    filterYearTo,
    filterExactMatching: Boolean(kwargs['filter-exact-matching']),
    filterRegexTitle,
    filterRegexAuthor,
    filterRegexPublisher,
    unlimited: Boolean(kwargs.unlimited),
    detail: Boolean(kwargs.detail),
    filenameTemplate: parseFilenameTemplate(kwargs['filename-template'])
  }
}

/**
 * Apply all active post‑filters in order.
 *
 * URL-based (server-side) filtering is the primary path; JS post-filters here
 * serve as a safety net for cases where the Z-Library server returns results
 * that don't match the requested filters (e.g. --filter-ext 'pdf' returns mobi).
 *
 * Filter order: most selective / cheapest first.
 */
function filterSearchResults (unfilteredResults, options) {
  let results = unfilteredResults

  // JS safety net for URL-based filters — the server sometimes ignores them
  if (options.filterExt && options.filterExt.length) {
    results = filterByExtension(results, options.filterExt)
  }
  if (options.filterLangCodes && options.filterLangCodes.length) {
    results = filterByLanguage(results, options.filterLangCodes)
  }
  if (options.filterContentType && options.filterContentType.length) {
    results = filterByContentType(results, options.filterContentType)
  }
  if (options.filterYearFrom != null || options.filterYearTo != null) {
    results = filterByYearRange(results, options.filterYearFrom, options.filterYearTo)
  }

  // Remove fake entries where the search returned garbage records
  results = filterByFakeEntries(results)

  // Regex filters (always JS-only)
  if (options.filterRegexTitle || options.filterRegexAuthor || options.filterRegexPublisher) {
    results = filterByRegex(results, options.filterRegexTitle, options.filterRegexAuthor, options.filterRegexPublisher)
  }

  return results
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

cli({
  site: 'zlibrary-app',
  name: 'search',
  access: 'read',
  description: 'Search Z-Library books',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'query',
      type: 'string',
      required: true,
      positional: true,
      help: 'Search keyword (title, author, ISBN, MD5:<hash>)'
    },
    {
      name: 'limit',
      type: 'int',
      default: 50,
      help: 'Max results (1–50)'
    },
    // -- Filter flags ------------------------------------------------
    {
      name: 'filter-lang-codes',
      type: 'string',
      help: 'Filter by language code (en, ja, zh, fr, de, etc.) — repeatable'
    },
    {
      name: 'filter-ext',
      type: 'string',
      help: 'Filter by file extension (pdf, epub, azw3, mobi) — repeatable'
    },
    {
      name: 'filter-content-type',
      type: 'string',
      help: 'Filter by content type (book, article) — repeatable'
    },
    {
      name: 'filter-year-from',
      type: 'int',
      help: 'Minimum publication year (inclusive)'
    },
    {
      name: 'filter-year-to',
      type: 'int',
      help: 'Maximum publication year (inclusive)'
    },
    {
      name: 'filter-exact-matching',
      type: 'boolean',
      help: 'Enable exact matching at URL level (e=1)'
    },
    {
      name: 'filter-regex-title',
      type: 'string',
      help: 'Filter by Unicode regex against title (flags: ui)'
    },
    {
      name: 'filter-regex-author',
      type: 'string',
      help: 'Filter by Unicode regex against author (flags: ui)'
    },
    {
      name: 'filter-regex-publisher',
      type: 'string',
      help: 'Filter by Unicode regex against publisher (flags: ui)'
    },
    {
      name: 'unlimited',
      type: 'boolean',
      help: 'Fetch all results across multiple pages (up to ~1000)'
    },
    {
      name: 'detail',
      type: 'boolean',
      help: 'Fetch each result\'s detail page for extra attributes (pages, ISBN, series, description, etc.) — slower'
    },
    {
      name: 'filename-template',
      type: 'string',
      help: 'Filename template for generating filenames (e.g., "{author} - {title}.{extension}")'
    },
    {
      name: 'list-filename-key-names',
      type: 'boolean',
      help: 'List all available filename template key names and exit'
    }
   ],
    columns: ['rank', 'title', 'author', 'year', 'language', 'language-code', 'extension', 'content-type', 'size', 'url', 'id', 'quality-rating', 'format-quality-rating', 'favorite', 'booklist', 'downloaded', 'publisher', 'isbn', 'pages', 'isbn-10', 'isbn-13', 'series', 'volume', 'categories', 'description', 'meta-description', 'detail-error'],
  func: async (page, kwargs) => {
    // Early exit: list available key names
    if (kwargs['list-filename-key-names']) {
      console.log('Available filename template key names:')
      for (const name of FILENAME_KEY_NAMES) {
        console.log('  {' + name + '}')
      }
      return []
    }

    const options = parseSearchOptions(kwargs)
    const queryMd5 = md5FromQuery(options.query)

    // --detail and --unlimited are mutually exclusive
    if (options.detail && options.unlimited) {
      throw new ArgumentError(
        'zlibrary-app search --detail and --unlimited are mutually exclusive',
        'Use --detail with a specific --limit, or use --unlimited without --detail.'
      )
    }

    // Resolve and validate the current page origin.
    // CDP should connect to the Z-Library HTTPS page, not the file:// shell.
    // This check applies to BOTH --unlimited and single-page paths.
    const startOrigin = await getCurrentHttpOrigin(page)

    // Build a filter query string for URL-based filtering.
    // When filters are provided, they are appended to the search URL so the
    // Desktop app pre-filters results server-side. JS post-filtering is kept
    // as a safety net for any results that slip through URL-based filtering.
    const filterQs = buildFilterQueryString(
      options.filterLangCodes, options.filterExt, options.filterContentType,
      options.filterYearFrom, options.filterYearTo, LANGUAGE_BY_CODE, options.filterExactMatching
    )

    if (options.unlimited) {
      const allResults = await fetchAllPages(page, options.query, 20, startOrigin.origin, filterQs)
      if (allResults.length > 200) {
        console.warn(
          'Large result set (' + allResults.length + ' results). ' +
              'Narrow it with --filter-lang-codes, --filter-ext, or --filter-year-from/--filter-year-to.'
        )
      }
      const filteredResults = filterSearchResults(allResults, options)
      // Inject MD5 hash from query into source rows BEFORE filename rendering
      if (queryMd5) {
        filteredResults.forEach(function (row) { row.md5 = queryMd5 })
      }
      // Normalize to full column shape with filename rendering
      const normalized = filteredResults.map(function (row) {
        return buildRowWithFilename(row, options.filenameTemplate)
      })
      return requireNonEmptyRows(
        normalized,
        'zlibrary-app search',
        'No books found matching your filters.'
      )
    }

    // Navigate to search results and extract results using shared pipeline.
    // This replaces the inline goto/wait/assert/extract sequence.
    const { results } = await collectSearchResultsPage(page, startOrigin, options.query, {
      filterQs,
      limit: 100,
      contextName: 'zlibrary-app search'
    })
    const filtered = filterSearchResults(results, options)
    const limited = filtered.slice(0, options.limit)

    // -- Per-row enrichment with --detail ------------------------------
    if (options.detail) {
      const resultsWithDetail = []
      for (let idx = 0; idx < limited.length; idx++) {
        // Inject MD5 hash from query into source row BEFORE filename rendering
        if (queryMd5) limited[idx].md5 = queryMd5
        const row = buildRowWithFilename(limited[idx], options.filenameTemplate)
        if (!row.url) {
          row['detail-error'] = 'no url'
          resultsWithDetail.push(row)
          continue
        }

        // Use shared enrichment function for navigate → extract.
        // Then merge with kebab-case key normalization for CLI output.
        const { metadata, error } = await enrichBookRowFromDetailPage(page, row, {
          origin: startOrigin,
          commandName: 'zlibrary-app search --detail',
        })
        if (error) {
          row['detail-error'] = error
        } else if (metadata) {
          // Normalize camelCase metadata keys to kebab-case for CLI output.
          // buildBookPageMetadata returns camelCase keys (filesize, rating, etc.)
          // but search output columns are kebab-case (filesize → filesize, rating → rating,
          // isbn10 → isbn-10, isbn13 → isbn-13, metaDescription → meta-description).
          const newData = normalizeOutputKeys(metadata)
          for (const [key, value] of Object.entries(newData)) {
            if (value !== '' && value !== null && value !== undefined) {
              row[key] = value
            }
          }
        }

        // Re-render filename once if template is active (metadata may have changed)
        if (options.filenameTemplate) {
          row.filename = renderFilenameTemplate(options.filenameTemplate, row)
        }
        // Remove internal-only metadata keys that are not CLI output columns.
        delete row.filesize
        delete row.rating
        resultsWithDetail.push(row)
      }
      return requireNonEmptyRows(
        resultsWithDetail,
        'zlibrary-app search',
        'No books found matching your filters.'
      )
    }

    // Inject MD5 hash from query into source rows BEFORE filename rendering
    if (queryMd5) {
      limited.forEach(function (row) { row.md5 = queryMd5 })
    }
    // Normalize rows with optional filename
    const normalized = limited.map(function (row) {
      return buildRowWithFilename(row, options.filenameTemplate)
    })
    return requireNonEmptyRows(
      normalized,
      'zlibrary-app search',
      'No books found matching your filters.'
    )
  },
})
