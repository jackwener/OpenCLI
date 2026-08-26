import { describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import {
  createBooklistShowPage,
  loadBooklistFixture,
  makeFixtureBooklists,
  makeFixtureBookRows
} from './_shared/test/booklist-test-utils.js'
import './booklist-show.js'

// ---------------------------------------------------------------------------
// Booklist Show — core behavior
// ---------------------------------------------------------------------------

function makeShowScenario (opts = {}) {
  const {
    variant = 'anonymous',
    bookCount = 1,
    rowCount = 1,
    origin = 'https://z-lib.gl',
    createdAt = '2024-01-01',
    bookUrls
  } = opts

  const fixture = loadBooklistFixture(variant)
  const booklists = makeFixtureBooklists(fixture, { count: 1, bookCount, createdAt })
  const books = makeFixtureBookRows(fixture, { count: rowCount, origin })

  // Apply URL overrides BEFORE building the page mock (otherwise the
  // evaluate queue is already sealed with the original fixture URLs).
  // `undefined` values preserve the original fixture URL.
  if (bookUrls) {
    const urls = Array.isArray(bookUrls) ? bookUrls : [bookUrls]
    urls.forEach(function (url, i) {
      if (books[i] && url !== undefined) books[i].url = url
    })
  }
  const infoResult = {
    id: booklists[0].id,
    title: booklists[0].title,
    bookCount,
    createdAt
  }

  return {
    fixture,
    booklists,
    books,
    infoResult,
    page: createBooklistShowPage({ booklists, infoResult, books, origin })
  }
}

describe('zlibrary-app booklist-show', () => {
  it('returns metadata row + book rows', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title })
    // First row: metadata
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      title: booklists[0].title,
      author: '(metadata)',
      'meta-books-total': 2,
      'meta-created': '2024-01-01'
    })
    // Following rows: books
    expect(result[1]).toMatchObject({ title: books[0].title, author: books[0].author, id: String(books[0].bookId) })
    expect(result[2]).toMatchObject({ title: books[1].title, id: String(books[1].bookId) })
  })

  it('handles empty booklist — returns 1 metadata row, 0 book rows', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      title: booklists[0].title,
      author: '(metadata)',
      'meta-books-total': 0
    })
  }, 15000)

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 1, rowCount: 1 })
    const [row] = await command.func(page, { name: booklists[0].title })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('filters by --filter-lang-codes', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title, 'filter-lang-codes': 'en' })
    // All fixture books are English — metadata + 2 book rows
    expect(result).toHaveLength(3)
    expect(result[0].title).toBe(booklists[0].title)
    expect(result[1].title).toBe(books[0].title)
    expect(result[2].title).toBe(books[1].title)
  })

  it('filters by --filter-ext', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title, 'filter-ext': 'epub' })
    // All fixture books are epub — metadata + 2 book rows
    expect(result).toHaveLength(3)
    expect(result[1].title).toBe(books[0].title)
    expect(result[2].title).toBe(books[1].title)
  })

  it('--full-columns returns extended fields', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 1, rowCount: 1 })
    const result = await command.func(page, { name: booklists[0].title, 'full-columns': true })
    expect(result[1]).toMatchObject({
      title: books[0].title,
      publisher: books[0].publisher,
      isbn: books[0].isbn,
      rating: books[0].qualityRating,
      series: books[0].series
    })
    // qualityRating from fixture is null → normalized to '' in makeFixtureBookRows
    expect(result[1].rating).toBe('')
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    await expect(
      command.func(createPageMock([]), { name: '' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })
})

// ---------------------------------------------------------------------------
// Booklist Show — URL sanitization
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — URL sanitization', () => {
  it('drops javascript: and empty URLs', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({
      bookCount: 3, rowCount: 3,
      bookUrls: [undefined, 'javascript:alert(1)', '']
    })
    const result = await command.func(page, { name: booklists[0].title })
    // First book: normal fixture URL (real book URL from fixture)
    expect(result[1].url).toBe(books[0].url)
    // Second: javascript: → empty
    expect(result[2].url).toBe('')
    // Third: empty → empty
    expect(result[3].url).toBe('')
  })

  it('drops malformed (throw-inducing) URLs', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({
      bookCount: 1, rowCount: 1,
      bookUrls: ['not a url at all!!!']
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[1].url).toBe('')
  })

  it('resolves relative URLs against current page origin', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({
      bookCount: 1, rowCount: 1,
      bookUrls: ['/book/123']
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[1].url).toBe('https://z-lib.gl/book/123')
  })
})

// ---------------------------------------------------------------------------
// Booklist Show — filter validation
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — filter validation', () => {
  it('filters by --filter-lang-codes using ISO code mapping', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title, 'filter-lang-codes': 'en' })
    // All fixture books are English — metadata + 2 book rows
    expect(result).toHaveLength(3)
    expect(result[1].title).toBe(books[0].title)
    expect(result[2].title).toBe(books[1].title)
  })

  it('filters by --filter-ext', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title, 'filter-ext': 'epub' })
    // All fixture books are epub — metadata + 2 book rows
    expect(result).toHaveLength(3)
    expect(result[1].title).toBe(books[0].title)
    expect(result[2].title).toBe(books[1].title)
  })

  it('throws ArgumentError for invalid language code (zero CDP calls)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    await expect(
      command.func(page, { name: 'Invalid', 'filter-lang-codes': 'xx' })
    ).rejects.toBeInstanceOf(ArgumentError)

    // Verify zero evaluate calls — validation threw before any CDP/API work
    expect(page.evaluate.mock.calls.length).toBe(0)
  })

  it('throws ArgumentError for invalid extension', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    await expect(
      command.func(page, { name: booklists[0].title, 'filter-ext': 'exe' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('filters by --filter-lang-names using display name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists, books } = makeShowScenario({ bookCount: 2, rowCount: 2 })
    const result = await command.func(page, { name: booklists[0].title, 'filter-lang-names': 'English' })
    // All fixture books are English — metadata + 2 book rows
    expect(result).toHaveLength(3)
    expect(result[1].title).toBe(books[0].title)
    expect(result[2].title).toBe(books[1].title)
  })

  it('throws ArgumentError for invalid language name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    await expect(
      command.func(page, { name: booklists[0].title, 'filter-lang-names': 'Klingon' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('throws ArgumentError for invalid language name with valid code', async () => {
    // --filter-lang-names validates display names, not ISO codes
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    await expect(
      command.func(page, { name: booklists[0].title, 'filter-lang-names': 'en' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })
})

// ---------------------------------------------------------------------------
// Booklist Show — metadata API 404 degradation
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — metadata API 404', () => {
  it('succeeds when metadata API returns 404 — preserves table schema', async () => {
    // Regression: getBooklistInfo returning HTTP 404 must not block DOM extraction
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const fixture = loadBooklistFixture()
    const booklists = makeFixtureBooklists(fixture, { count: 1, bookCount: 3, createdAt: '2024-01-01' })
    const books = makeFixtureBookRows(fixture, { count: 1 })
    const page = createBooklistShowPage({
      booklists,
      infoResult: { error: 'HTTP 404: Not Found', _httpStatus: 404 },
      books,
    })
    const result = await command.func(page, { name: booklists[0].title })
    // Must still return metadata row + book rows
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ author: '(metadata)', 'meta-books-total': 3 })
    expect(result[1]).toMatchObject({ title: books[0].title, author: books[0].author, id: String(books[0].bookId) })
    // URL must still be present (sanitized by origin)
    expect(result[1].url).toMatch(/^https?:\/\//)
  }, 15000)

  it('uses entry.bookCount when metadata 404s (no enrichment)', async () => {
    // When getBooklistInfo returns 404, enrichment is skipped and
    // the entry's bookCount (from API discovery) is used.
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const fixture = loadBooklistFixture()
    const booklists = makeFixtureBooklists(fixture, { count: 1, bookCount: 7, createdAt: '2024-01-01' })
    const books = makeFixtureBookRows(fixture, { count: 1 })
    const page = createBooklistShowPage({
      booklists,
      infoResult: { error: 'HTTP 404: Not Found', _httpStatus: 404 },
      books,
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[0]['meta-books-total']).toBe(7)
  }, 15000)
})

// ---------------------------------------------------------------------------
// Booklist Show — metadata edge cases
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — metadata edge cases', () => {
  it('uses info.bookCount when match.bookCount is undefined (precedence fix)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 5, rowCount: 0 })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[0]['meta-books-total']).toBe(5)
  }, 15000)

  it('uses match.bookCount when info.bookCount is undefined', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const fixture = loadBooklistFixture()
    const booklists = makeFixtureBooklists(fixture, { count: 1, bookCount: 3, createdAt: '2024-01-01' })
    const page = createBooklistShowPage({
      booklists,
      infoResult: { id: booklists[0].id, title: booklists[0].title },
      books: []
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[0]['meta-books-total']).toBe(3)
  }, 15000)

  it('returns 0 when neither info nor match has bookCount', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({ bookCount: 0, rowCount: 0 })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[0]['meta-books-total']).toBe(0)
  }, 15000)
})

// ---------------------------------------------------------------------------
// Booklist Show — URL boundary (cross-origin rejection)
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — URL boundary', () => {
  it('rejects cross-origin absolute URLs', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({
      bookCount: 1, rowCount: 1,
      bookUrls: ['https://evil.example.com/book/1']
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[1].url).toBe('')
  })

  it('rejects javascript: URLs', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const { page, booklists } = makeShowScenario({
      bookCount: 1, rowCount: 1,
      bookUrls: ['javascript:alert(1)']
    })
    const result = await command.func(page, { name: booklists[0].title })
    expect(result[1].url).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Booklist Show — booklist scoping
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-show — scoping', () => {
  it('passes booklistId to getBookIdList for API scoping', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-show')
    const fixture = loadBooklistFixture()
    const booklists = makeFixtureBooklists(fixture, { count: 1, bookCount: 0, createdAt: '2024-01-01' })
    booklists[0].id = 42
    booklists[0].title = 'Scoped List'
    const page = createBooklistShowPage({
      booklists,
      infoResult: { id: 42, title: 'Scoped List', bookCount: 0, createdAt: '2024-01-01' },
      books: []
    })
    const result = await command.func(page, { name: booklists[0].title })
    // Empty booklist is valid: 1 metadata row
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ author: '(metadata)' })
    // Verify the search URL contains the booklist name for scope tab matching
    expect(page.goto).toHaveBeenCalledTimes(2)
    const searchCall = page.goto.mock.calls[0]
    expect(searchCall[0]).toContain('/booklists/my?searchQuery=')
    expect(searchCall[0]).toContain(encodeURIComponent('Scoped List'))
  }, 15000)
})
