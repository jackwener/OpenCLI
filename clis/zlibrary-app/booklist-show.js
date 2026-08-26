/**
 * Z-Library Desktop booklist-show command.
 *
 * Shows booklist metadata + books in a single merged output.
 * First row is metadata (title, id, books total, created date with
 * '(metadata)' in author column); remaining rows are book entries.
 *
 * Empty booklist is valid — returns 1 metadata row + 0 book rows.
 *
 * Supports display filters (--filter-lang-codes, --filter-lang-names,
 * --filter-ext) and extended columns (--full-columns).
 *
 * URL sanitization: all URLs from the API are validated for same-origin
 * + http/https inside the evaluate script, before crossing the CDP boundary.
 * Node.js retains a defense-in-depth check via sanitizeUrl().
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { readBooklistSnapshot } from './_shared/booklist/read-snapshot.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { filterByLanguage, filterByExtension, filterByLanguageNames } from './_shared/infra/search-pipeline.js'
import { validateLanguage, validateLanguageName, validateExtension, languageCodeByName } from '../zlibrary/dom.js'
import { toSameOriginAbsoluteUrl } from './_shared/infra/url-boundary.js'

export const booklistShowCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-show',
  access: 'read',
  description: 'Show a Z-Library booklist\'s metadata and books',
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
      name: 'scope',
      type: 'string',
      default: 'my',
      help: 'Booklist scope: public, favorite, my'
    },
    {
      name: 'full-columns',
      type: 'boolean',
      help: 'Show extended fields (publisher, isbn, rating, series, description)'
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
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: ['id', 'title', 'author', 'size', 'extension', 'year', 'language', 'language-code', 'url', 'content-type', 'meta-books-total', 'meta-created', 'publisher', 'isbn', 'rating', 'series', 'description'],
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-show name cannot be empty',
        'Example: opencli zlibrary-app booklist-show mylist'
      )
    }

    // Validate scope
    const scope = String(kwargs.scope || 'my').toLowerCase()
    if (!['public', 'favorite', 'my'].includes(scope)) {
      throw new ArgumentError(
        'Invalid scope: ' + scope,
        'Valid scopes: public, favorite, my'
      )
    }

    // Parse and validate filter args BEFORE any CDP/API calls (oracle finding #2).
    // Throws ArgumentError for invalid values, preventing unnecessary browser work.
    const languages = toArray(kwargs['filter-lang-codes'])
    const langNames = toArray(kwargs['filter-lang-names'])
    const extensions = toArray(kwargs['filter-ext'])
    assertKnownValues(languages, validateLanguage, 'filter-lang-codes', 'en, ja, zh, fr, de, etc.')
    if (langNames.length) {
      assertKnownValues(langNames, validateLanguageName, 'filter-lang-names', 'English, Japanese, Chinese, French, German')
    }
    assertKnownValues(extensions, validateExtension, 'filter-ext', 'pdf, epub, azw3, mobi')

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    // Acquire snapshot via shared kernel (scope-aware, 404-tolerant)
    const snapshot = await readBooklistSnapshot(page, { name, scope, fixture })
    const { entry, books, origin } = snapshot

    // Build row objects with URL sanitization against current page origin
    function toRow (m) {
      return {
        title: m.title || '',
        author: m.author || '',
        year: m.year != null ? String(m.year) : '',
        language: m.language || '',
        'language-code': languageCodeByName(m.language || ''),
        extension: m.extension || '',
        'content-type': m.contentType || m.content_type || '',
        size: m.size || '',
        url: sanitizeUrl(m.url, origin),
        id: m.bookId != null ? String(m.bookId) : '',
        // Extra fields (used by --full-columns)
        _publisher: m.publisher || '',
        _isbn: m.isbn || '',
        _rating: String(m.qualityRating ?? ''),
        _series: m.series || '',
        _description: m.description || ''
      }
    }

    let bookRows = books.map(toRow)

    // Apply display filters using shared filter functions
    bookRows = filterByLanguage(bookRows, languages)
    if (langNames.length) bookRows = filterByLanguageNames(bookRows, langNames)
    bookRows = filterByExtension(bookRows, extensions)

    // Build merged output: metadata row + book rows
    const showFull = !!kwargs['full-columns']
    const rows = []

    // First row: metadata
    const metaBooksTotal = entry.bookCount != null ? entry.bookCount : 0
    const metaCreated = entry.createdAt || ''
    rows.push({
      id: entry.id != null ? String(entry.id) : '',
      title: entry.title || name,
      author: '(metadata)',
      size: '',
      extension: '',
      year: '',
      language: '',
      'language-code': '',
      url: '',
      'content-type': '',
      'meta-books-total': metaBooksTotal,
      'meta-created': metaCreated,
      publisher: '',
      isbn: '',
      rating: '',
      series: '',
      description: ''
    })

    // Following rows: books
    for (let i = 0; i < bookRows.length; i++) {
      const r = bookRows[i]
      rows.push({
        id: r.id,
        title: r.title,
        author: r.author,
        size: r.size,
        extension: r.extension,
        year: r.year,
        language: r.language,
        'language-code': r['language-code'],
        url: r.url,
        'content-type': r['content-type'],
        'meta-books-total': '',
        'meta-created': '',
        publisher: showFull ? r._publisher : '',
        isbn: showFull ? r._isbn : '',
        rating: showFull ? r._rating : '',
        series: showFull ? r._series : '',
        description: showFull ? r._description : ''
      })
    }

    fixture?.save('booklist-show', kwargs)

    return rows
  }
})

/**
 * Validate and resolve a URL against the current page origin.
 *
 * Delegates to toSameOriginAbsoluteUrl from url-boundary.js for consistent
 * same-origin + http(s) validation semantics across all commands.
 *
 * @param {string|null|undefined} url
 * @param {string} origin — window.location.origin of the connected page
 * @returns {string}
 */
function sanitizeUrl (url, origin) {
  return toSameOriginAbsoluteUrl(url, origin)
}

/**
 * Normalise a potentially multi-value CLI arg into a clean string array.
 */
function toArray (value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  return String(value).split(',').map(function (s) { return s.trim() }).filter(Boolean)
}

/**
 * Validate known filter values, throwing ArgumentError for unknowns.
 */
function assertKnownValues (values, isKnown, argName, examples) {
  const unknown = values.filter(function (v) { return !isKnown(v) })
  if (!unknown.length) return
  throw new ArgumentError(
    'booklist-show --' + argName + ' has unsupported value(s): ' + unknown.join(', '),
    'Supported values include: ' + examples
  )
}
