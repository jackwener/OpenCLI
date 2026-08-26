/**
 * Z-Library Desktop booklist-add command.
 *
 * Adds books to a booklist from either a search query (--query)
 * or the current page's search results (--current-page).
 * Deduplicates against existing books in the target booklist.
 *
 * Only counts adds where the server response confirms success
 * (readlistBookId is non-null). Failed adds are tracked as skipped.
 *
 * Requires explicit --query or --current-page. No implicit fallback.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError } from '@jackwener/opencli/errors'
import { requireNonEmptyRows } from '../_shared/search-adapter.js'
import { extractSearchResults } from '../zlibrary/dom.js'
import { resolveBooklistByNameOrThrow, addBookToBooklist } from './_shared/booklist/api.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { parseBooklistSearchOptions, collectBooksForBooklist, applyBooklistSearchFilters } from './_shared/infra/booklist-search.js'
import { resolveBookSelector, navigateAndExtractBookId } from './_shared/infra/book-selector.js'
import { addBooksToBooklist, isSuccessfulBooklistAdd } from './_shared/infra/booklist-mutation.js'
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js'

const SUMMARY_COLUMNS = ['booklist', 'added', 'skipped', 'total']
const LIST_COLUMNS = ['title', 'author', 'year', 'edition', 'language', 'size', 'format', 'isbn', 'url', 'status']

function parseListMode (value, commandName) {
  const mode = value == null ? null : String(value).trim().toLowerCase()
  if (mode == null || mode === '') return null
  if (mode !== 'add' && mode !== 'skip' && mode !== 'all') {
    throw new ArgumentError(commandName + ' --list must be one of: add, skip, all')
  }
  return mode
}

function buildListRow (book, status, reason) {
  const statusText = status === 'skipped' ? 'skipped (' + reason + ')' : 'added'
  return {
    title: String(book?.title || ''),
    author: String(book?.author || ''),
    year: String(book?.year || ''),
    edition: String(book?.edition || ''),
    language: String(book?.language || ''),
    size: String(book?.size || ''),
    format: String(book?.extension || book?.format || ''),
    isbn: String(book?.isbn || ''),
    url: String(book?.url || ''),
    status: statusText
  }
}

/** Project a row object onto LIST_COLUMNS, preserving the output key order. */
function toListRow (row) {
  return Object.fromEntries(LIST_COLUMNS.map(function (key) { return [key, row[key]] }))
}

/** Build an all-empty list row used as the trailing summary line. */
function emptyListRow () {
  return Object.fromEntries(LIST_COLUMNS.map(function (key) { return [key, ''] }))
}

function toAbsoluteBookUrl (origin, path) {
  const safeOrigin = String(origin || '').trim()
  const safePath = String(path || '').trim()
  if (!safePath) return ''
  if (!safeOrigin) return safePath
  try {
    return new URL(safePath, safeOrigin).href
  } catch {
    return safePath
  }
}

export const booklistAddCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-add',
  access: 'write',
  description: 'Add Z-Library books to a booklist from search or the current page',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Booklist name (must exist — create with booklist-create first)'
    },
    {
      name: 'query',
      type: 'string',
      help: 'Search query to find books to add'
    },
    {
      name: 'current-page',
      type: 'boolean',
      help: 'Use current page search results (instead of --query)'
    },
    {
      name: 'limit', type: 'int',
      help: 'Max results to add, default 50 (1–50)'
    },
    {
      name: 'filter-lang-codes',
      type: 'string',
      help: 'Filter by language code (en, ja, zh, fr, de, etc.) — repeatable'
    },
    {
      name: 'filter-lang-names',
      type: 'string',
      help: 'Filter by language display name — repeatable'
    },
    {
      name: 'filter-ext',
      type: 'string',
      help: 'Filter by file extension (pdf, epub, azw3, mobi) — repeatable'
    },
    {
      name: 'filter-year-from',
      type: 'int',
      help: 'Filter by minimum publication year (inclusive)'
    },
    {
      name: 'filter-year-to',
      type: 'int',
      help: 'Filter by maximum publication year (inclusive)'
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
      help: 'Fetch all search results across multiple pages (up to ~1000)'
    },
    {
      name: 'book-id',
      type: 'string',
      help: 'Add a specific book by ID or URL (mutually exclusive with --query / --current-page). E.g. 5433175, /book/demo, https://z-lib.org/book/12345'
    },
    {
      name: 'list',
      type: 'string',
      help: 'Show per-book rows by status: add | skip | all'
    },
    {
      name: 'scope',
      type: 'string',
      default: 'my',
      choices: ['public', 'favorite', 'my'],
      help: 'Booklist scope (only my is valid for write operations)'
    },
    {
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: SUMMARY_COLUMNS,
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-add name cannot be empty',
        'Example: opencli zlibrary-app booklist-add mylist --query python'
      )
    }

    const scope = String(kwargs.scope || 'my')
    if (scope !== 'my') {
      throw new ArgumentError(
        'Write operations only support --scope my',
        'Omit --scope or pass --scope my'
      )
    }

    const lock = await acquireLockOrThrow('zlibrary-app booklist-add')
    try {
      const listMode = parseListMode(kwargs.list, 'zlibrary-app booklist-add')
      booklistAddCommand.columns = listMode == null ? SUMMARY_COLUMNS : LIST_COLUMNS

      // Require exactly one source: --query, --current-page, or --book-id
      const hasQuery = kwargs.query != null && String(kwargs.query).trim() !== ''
      const hasCurrentPage = !!kwargs['current-page']
      const hasBookId = kwargs['book-id'] != null && String(kwargs['book-id']).trim() !== ''
      const sources = [hasQuery, hasCurrentPage, hasBookId].filter(Boolean)

      if (sources.length === 0) {
        throw new ArgumentError(
          'Requires --query, --current-page, or --book-id',
          'Use --query to search, --current-page to use the current page\'s search results, or --book-id to add a specific book.'
        )
      }
      if (sources.length > 1) {
        throw new ArgumentError(
          '--query, --current-page, and --book-id are mutually exclusive',
          'Pick one: --query, --current-page, or --book-id.'
        )
      }

      const fixture = kwargs.fixture
        ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
        : null

      // Validate --book-id format early (before any browser/API calls)
      let bookIdSelector = null
      if (hasBookId) {
        bookIdSelector = resolveBookSelector(kwargs['book-id'], '--book-id')
      }

      // Resolve booklist name to ID (throws CommandExecutionError if not found)
      const match = await resolveBooklistByNameOrThrow(page, name, undefined, { recorder: fixture })
      const booklistId = match.id

      // -- Handle --book-id path -------------------------------------------
      if (hasBookId) {
        const selector = bookIdSelector
        const bookId = await navigateAndExtractBookId(page, selector)

        // NOTE: getBookIdList() returns ALL booklist-book mappings (cross-booklist),
        // so we cannot use it for per-booklist dedup. Server handles dedup.
        const result = await addBookToBooklist(page, booklistId, bookId, { recorder: fixture })
        const success = isSuccessfulBooklistAdd(result)

        if (listMode != null) {
          const relativePath = selector.kind === 'url' ? selector.urlRelative : ('/book/' + bookId)
          const absoluteUrl = toAbsoluteBookUrl(selector.kind === 'url' ? selector.originalOrigin : '', relativePath)
          const row = buildListRow({ id: bookId, url: absoluteUrl }, success ? 'added' : 'skipped', success ? null : 'API error')
          if (listMode === 'add' && !success) return []
          if (listMode === 'skip' && success) return []
          const entries = [toListRow(row)]
          // Append summary row
          const summaryRow = emptyListRow()
          summaryRow.status = (success ? 1 : 0) + ' added / ' + (success ? 0 : 1) + ' skipped / 1 total'
          entries.push(summaryRow)
          return entries
        }

        fixture?.save('booklist-add', kwargs)

        return [{
          booklist: name,
          added: success ? 1 : 0,
          skipped: success ? 0 : 1,
          total: 1
        }]
      }

      // Parse and validate filter args BEFORE browser/API work (early validation)
      const options = parseBooklistSearchOptions(kwargs, 'add')

      // Get books to add
      let books
      if (hasQuery) {
        // --query: use shared search + filter + empty-check pipeline
        const query = String(kwargs.query).trim()
        books = await collectBooksForBooklist(page, query, options, 'add')
      } else {
        // --current-page: read current page's search results and apply filters
        books = await extractSearchResults(page, options.limit)

        // Apply display filters (same as --query path)
        books = applyBooklistSearchFilters(books, options)

        requireNonEmptyRows(
          books,
          'zlibrary-app booklist-add',
          'No books found. Use --query to search, or navigate to a search results page first.'
        )
      }

      // NOTE: getBookIdList() returns ALL booklist-book mappings across all
      // booklists (the API ignores ?booklistId=N). Since we can't scope
      // dedup to just this booklist, skip pre-check dedup entirely.
      // The add-book endpoint handles server-side dedup.
      const mutationResult = await addBooksToBooklist(page, booklistId, books, {
        dedupe: false,
        collectRows: listMode != null,
        recorder: fixture,
      })

      const { added, skipped } = mutationResult

      if (listMode != null) {
        const rows = mutationResult.rows
          .filter(function (row) {
            if (listMode === 'all') return true
            if (listMode === 'add') return row.status === 'added'
            return row.status === 'skipped'
          })
          .map(function (row) {
            return buildListRow(row.book, row.status, row.reason)
          })
        // Append summary row so user sees per-book status and total stats
        const summaryRow = emptyListRow()
        summaryRow.status = added + ' added / ' + skipped + ' skipped / ' + books.length + ' total'
        rows.push(summaryRow)
        // Preserve output schema with explicit key order
        return rows.map(toListRow)
      }

      fixture?.save('booklist-add', kwargs)

      return [{
        booklist: name,
        added,
        skipped,
        total: books.length
      }]
    } finally {
      await lock.release()
    }
  }
});
