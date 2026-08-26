/**
 * Z-Library Desktop booklist-create command.
 *
 * Creates a new booklist via CDP API injection (POST /papi/booklist/create).
 * Checks for duplicate names first.
 *
 * When --query is provided:
 *   1. Creates the booklist (fails if name already exists — no partial state)
 *   2. Navigates to search page and submits the query
 *   3. Applies any --filter-* / --limit / --unlimited options
 *   4. Adds result book IDs to the newly created list
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { getBooklistIdByName, createBooklist } from './_shared/booklist/api.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { parseBooklistSearchOptions, collectBooksForBooklist, hasBooklistSearchArgs } from './_shared/infra/booklist-search.js'
import { addBooksToBooklist, isSuccessfulBooklistAdd } from './_shared/infra/booklist-mutation.js'

const SUMMARY_COLUMNS = ['name', 'id', 'created', 'added', 'skipped', 'total']
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

export const booklistCreateCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-create',
  access: 'write',
  description: 'Create a Z-Library booklist (optionally populate it with --query)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Booklist name'
    },
    {
      name: 'description',
      type: 'string',
      help: 'Optional description for the booklist'
    },
    {
      name: 'query',
      type: 'string',
      help: 'Search query to find books and add to the new booklist'
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
      help: 'Filter by minimum publication year (inclusive) — requires --query'
    },
    {
      name: 'filter-year-to',
      type: 'int',
      help: 'Filter by maximum publication year (inclusive) — requires --query'
    },
    {
      name: 'filter-exact-matching',
      type: 'boolean',
      help: 'Enable exact matching at URL level (e=1) — requires --query'
    },
    {
      name: 'filter-regex-title',
      type: 'string',
      help: 'Filter by Unicode regex against title (flags: ui) — requires --query'
    },
    {
      name: 'filter-regex-author',
      type: 'string',
      help: 'Filter by Unicode regex against author (flags: ui) — requires --query'
    },
    {
      name: 'filter-regex-publisher',
      type: 'string',
      help: 'Filter by Unicode regex against publisher (flags: ui) — requires --query'
    },
    {
      name: 'limit', type: 'int',
      help: 'Max results to add, default 50 (1–50)'
    },
    {
      name: 'unlimited',
      type: 'boolean',
      help: 'Fetch all search results across multiple pages (up to ~1000)'
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
        'booklist-create name cannot be empty',
        'Example: opencli zlibrary-app booklist-create mylist'
      )
    }

    const scope = String(kwargs.scope || 'my')
    if (scope !== 'my') {
      throw new ArgumentError(
        'Write operations only support --scope my',
        'Omit --scope or pass --scope my'
      )
    }

    const desc = String(kwargs.description || '').trim()
    const listMode = parseListMode(kwargs.list, 'zlibrary-app booklist-create')
    booklistCreateCommand.columns = listMode == null ? SUMMARY_COLUMNS : LIST_COLUMNS

    // Parse and validate filter/search options BEFORE any CDP/API calls (oracle finding #2).
    // Throws ArgumentError for invalid values, preventing unnecessary browser work.
    const query = String(kwargs.query || '').trim()
    const hasQuery = query !== ''

    // Reject search-only filter flags when there's no --query
    if (!hasQuery && hasBooklistSearchArgs(kwargs)) {
      throw new ArgumentError(
        'booklist-create search filter flags (--filter-*) require --query',
        'Use --query with --filter-lang-codes, --filter-ext, --filter-year-from, --filter-year-to, etc.'
      )
    }

    const options = hasQuery ? parseBooklistSearchOptions(kwargs, 'create') : { limit: 50 }

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    // Check for duplicate name BEFORE any mutation
    const existingId = await getBooklistIdByName(page, name, { recorder: fixture })
    if (existingId != null) {
      throw new CommandExecutionError(
        'Booklist "' + name + '" already exists (ID: ' + existingId + ')'
      )
    }

    const result = await createBooklist(page, name, desc, { recorder: fixture })

    // Throw CommandExecutionError on write failure (oracle finding #4)
    // The allowError flag is set on createBooklist, so API errors come back as
    // { error: '...' } rather than throwing. Check for error field explicitly.
    if (!result || result.error) {
      throw new CommandExecutionError(
        'Failed to create booklist "' + name + '"' +
          (result && result.error ? ': ' + result.error : ''),
        'Check that the Z-Library Desktop app is connected and try again.'
      )
    }
    if (!result.id) {
      throw new CommandExecutionError(
        'Failed to create booklist "' + name + '" — API returned no ID',
        'The API may have changed. Check Z-Library Desktop app version.'
      )
    }

    const booklistId = result.id

    if (!hasQuery) {
      fixture?.save('booklist-create', kwargs)
      return [{
        name,
        id: booklistId,
        created: true,
        added: 0,
        skipped: 0,
        total: 0
      }]
    }

    // Search for books, apply filters, enforce non-empty
    const books = await collectBooksForBooklist(page, query, options, 'create')

    // Add books using shared mutation module (dedup against empty set since
    // this is a newly created booklist — no duplicates expected)
    const mutationResult = await addBooksToBooklist(page, booklistId, books, {
      existingBookIds: new Set(),
      dedupe: true,
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
      const summaryRow = Object.fromEntries(
        LIST_COLUMNS.map(function (key) { return [key, ''] })
      )
      summaryRow.status = added + ' added / ' + skipped + ' skipped / ' + books.length + ' total'
      rows.push(summaryRow)
      return rows.map(function (row) {
        return Object.fromEntries(LIST_COLUMNS.map(function (key) { return [key, row[key]] }))
      })
    }

    return [{
      name,
      id: booklistId,
      created: true,
      added,
      skipped,
      total: books.length
    }]
  }
})
