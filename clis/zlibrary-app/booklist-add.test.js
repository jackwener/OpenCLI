import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError } from '@jackwener/opencli/errors'
import { createBooklistAddPage } from './_shared/test/booklist-test-utils.js'
import { createPageMock } from '../test-utils.js'
import './booklist-add.js'

describe('zlibrary-app booklist-add', () => {
  it('adds books from --query', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { id: '100', title: 'Book A', author: 'Author A' },
        { id: '200', title: 'Book B', author: 'Author B' }
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '20', readlist_id: 1, book_id: 200 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python' })
    expect(result[0]).toMatchObject({ added: 2, skipped: 0, total: 2 })
  })

  it('returns per-book added rows with --list add', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { id: '100', title: 'Book A', author: 'Author A', year: '2020', language: 'English', size: '1 MB', extension: 'pdf', isbn: '123', url: 'https://z-lib.org/book/100' },
        { title: 'No ID Book', author: 'Author B', year: '2021', language: 'English', size: '2 MB', extension: 'epub', isbn: '456', url: 'https://z-lib.org/book/na' },
        { id: '200', title: 'Book C', author: 'Author C', year: '2022', language: 'Japanese', size: '3 MB', extension: 'epub', isbn: '789', url: 'https://z-lib.org/book/200' }
      ],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '20', readlist_id: 1, book_id: 200 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python', list: 'add' })
    expect(result).toHaveLength(3)
    expect(result.map(function (r) { return r.status })).toEqual(['added', 'added', '2 added / 1 skipped / 3 total'])
    expect(result[0]).toMatchObject({ title: 'Book A', author: 'Author A', status: 'added' })
    expect(result[1]).toMatchObject({ title: 'Book C', author: 'Author C', status: 'added' })
  })

  it('returns only skipped rows with reason for --list skip', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { title: 'No ID Book', author: 'Author A', url: 'https://z-lib.org/book/na' },
        { id: '200', title: 'API Fails Book', author: 'Author B', url: 'https://z-lib.org/book/200' },
        { id: '300', title: 'Added Book', author: 'Author C', url: 'https://z-lib.org/book/300' }
      ],
      addResponses: [
        { error: 'Server error' },
        { success: 1, book: { id: '30', readlist_id: 1, book_id: 300 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python', list: 'skip' })
    expect(result).toHaveLength(3)
    expect(result[0].status).toMatch(/^skipped \(empty ID\)$/)
    expect(result[1].status).toMatch(/^skipped \(API error: Server error\)$/)
    expect(result[2].status).toMatch(/\d+ added \/ 2 skipped \/ 3 total/)
  })

  it('returns added and skipped rows for --list all', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { id: '100', title: 'Added Book', author: 'Author A', url: 'https://z-lib.org/book/100' },
        { title: 'No ID Book', author: 'Author B', url: 'https://z-lib.org/book/na' }
      ],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: 100 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python', list: 'all' })
    expect(result).toHaveLength(3)
    expect(result.map(function (r) { return r.status })).toEqual(['added', 'skipped (empty ID)', '1 added / 1 skipped / 2 total'])
  })

  it('requires --query or --current-page', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('accepts --current-page as alternative to --query', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      hasQuery: false,
      searchResults: [
        { id: '300', title: 'Current Page Book', author: 'Author C' }
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '30', readlist_id: 1, book_id: 300 } }
      ]
    })
    const result = await command.func(page, { name: 'My List', 'current-page': true })
    expect(result[0]).toMatchObject({ added: 1, skipped: 0, total: 1 })
  })

  // NOTE: client-side dedup via getBookIdList was removed because the API
  // returns ALL booklist-book mappings (not scoped to a single booklist),
  // causing false duplicate detection. Server handles dedup.
  it('adds all books from search — no client-side dedup', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { id: '100', title: 'Book A', author: 'Author A' },
        { id: '200', title: 'Book B', author: 'Author B' }
      ],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '20', readlist_id: 1, book_id: 200 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python' })
    expect(result[0]).toMatchObject({ added: 2, skipped: 0, total: 2 })

    // Both books get add-book calls — no client-side dedup
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const addBookCalls = scripts.filter(function (s) { return s.includes('/add-book/') })
    expect(addBookCalls.length).toBe(2)
    expect(addBookCalls[0]).toContain('/add-book/100')
    expect(addBookCalls[1]).toContain('/add-book/200')
  })

  // Priority 2: strengthen empty-ID test with script inspection
  it('skips books with empty id — proves no add-book call for missing id', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { title: 'No ID Book' }, // no id field → skipped
        { id: '200', title: 'Good Book' } // has id → added
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '20', readlist_id: 1, book_id: 200 } } // only for book 200
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python' })
    expect(result[0]).toMatchObject({ added: 1, skipped: 1, total: 2 })

    // Only one add-book call (for book 200, not the one without id)
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const addBookCalls = scripts.filter(function (s) { return s.includes('/add-book/') })
    expect(addBookCalls.length).toBe(1)
    expect(addBookCalls[0]).toContain('/add-book/200')
  })

  // Priority 2: verify failed adds still make their API calls
  it('does not count failed adds — but API calls are still made', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      searchResults: [
        { id: '100', title: 'Book A' },
        { id: '200', title: 'Book B' }
      ],
      existingMappings: [],
      addResponses: [
        { error: 'Server error' }, // #1 fails
        { success: 1, book: { id: '20', readlist_id: 1, book_id: 200 } } // #2 succeeds
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python' })
    expect(result[0]).toMatchObject({ added: 1, skipped: 1, total: 2 })

    // Both add-book API calls are still made (failures are at the server level)
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const addBookCalls = scripts.filter(function (s) { return s.includes('/add-book/') })
    expect(addBookCalls.length).toBe(2)
    expect(addBookCalls[0]).toContain('/add-book/100')
    expect(addBookCalls[1]).toContain('/add-book/200')
  })

  // Priority 5: invalid language throws
  it('throws ArgumentError for invalid --filter-lang-codes', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List', query: 'test', 'filter-lang-codes': 'xx' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  // Priority 5: invalid extension throws
  it('throws ArgumentError for invalid --filter-ext', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List', query: 'test', 'filter-ext': 'exe' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  // Mutual exclusion
  it('throws ArgumentError for --limit + --unlimited', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List', query: 'test', limit: 5, unlimited: true })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('passes through all books with --filter-ext and --current-page (ext is URL-only, no-op on current page)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'Current Page Filter' }],
      searchResults: [
        { id: '100', title: 'PDF Book', extension: 'pdf' },
        { id: '200', title: 'EPUB Book', extension: 'epub' }
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '11', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '12', readlist_id: 1, book_id: 200 } }
      ],
      hasQuery: false // --current-page mode
    })
    const result = await command.func(page, { name: 'Current Page Filter', 'current-page': true, 'filter-ext': 'pdf' })
    // --filter-ext is URL-only — no JS post-filter applied. Both books pass through.
    expect(result[0]).toMatchObject({ added: 2, total: 2 })
  })

  it('passes through all books with --filter-lang-codes and --current-page (URL-only, no-op on current page)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'Current Page Lang' }],
      searchResults: [
        { id: '100', title: 'English Book', language: 'English' },
        { id: '200', title: 'Japanese Book', language: 'Japanese' }
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '66', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '67', readlist_id: 1, book_id: 200 } }
      ],
      hasQuery: false
    })
    const result = await command.func(page, { name: 'Current Page Lang', 'current-page': true, 'filter-lang-codes': 'ja' })
    expect(result[0]).toMatchObject({ added: 2, total: 2 })
  })

  it('passes through all books with --filter-lang-names and --current-page (URL-only, no-op on current page)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'Current Page Name' }],
      searchResults: [
        { id: '100', title: 'English Book', language: 'English' },
        { id: '200', title: 'German Book', language: 'German' }
      ],
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '77', readlist_id: 1, book_id: 100 } },
        { success: 1, book: { id: '78', readlist_id: 1, book_id: 200 } }
      ],
      hasQuery: false
    })
    const result = await command.func(page, { name: 'Current Page Name', 'current-page': true, 'filter-lang-names': 'German' })
    expect(result[0]).toMatchObject({ added: 2, total: 2 })
  })

  // -- --book-id support ----------------------------------------------------

  it('adds book via --book-id with numeric ID', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      singleBook: {
        extractedBookId: '5433175',
        existingMappings: [],
        addResult: { success: 1, book: { id: '42', readlist_id: 1, book_id: 5433175 } }
      }
    })
    const result = await command.func(page, { name: 'My List', 'book-id': '5433175' })
    expect(result[0]).toMatchObject({ added: 1, skipped: 0, total: 1 })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.gl/book/5433175', expect.any(Object))
  })

  it('adds book via --book-id with relative URL', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      singleBook: {
        extractedBookId: '5433175',
        existingMappings: [],
        addResult: { success: 1, book: { id: '99', readlist_id: 1, book_id: 5433175 } }
      }
    })
    const result = await command.func(page, { name: 'My List', 'book-id': '/book/demo' })
    expect(result[0]).toMatchObject({ added: 1, total: 1 })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.gl/book/demo', expect.any(Object))
  })

  it('returns populated URL row for --book-id with --list all', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      singleBook: {
        extractedBookId: '5433175',
        addResult: { success: 1, book: { id: '99', readlist_id: 1, book_id: 5433175 } }
      }
    })

    const result = await command.func(page, { name: 'My List', 'book-id': '/book/demo', list: 'all' })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ status: 'added', url: '/book/demo' })
    expect(result[1].status).toMatch(/1 added \/ 0 skipped \/ 1 total/)
  })

  it('adds book via --book-id with absolute URL (same origin)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      singleBook: {
        origin: 'https://z-lib.org',
        extractedBookId: '5433175',
        existingMappings: [],
        addResult: { success: 1, book: { id: '99', readlist_id: 1, book_id: 5433175 } }
      }
    })
    const result = await command.func(page, { name: 'My List', 'book-id': 'https://z-lib.org/book/demo' })
    expect(result[0]).toMatchObject({ added: 1, total: 1 })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/demo', expect.any(Object))
  })

  it('adds book via --book-id even if already in other booklists (no client-side dedup)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 1 }],
      singleBook: {
        extractedBookId: '100',
        addResult: { success: 1, book: { id: '10', readlist_id: 1, book_id: 100 } }
      }
    })
    const result = await command.func(page, { name: 'My List', 'book-id': '100' })
    expect(result[0]).toMatchObject({ added: 1, skipped: 0, total: 1 })
    // addBookToBooklist is always called — no client-side dedup
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const addBookCalls = scripts.filter(function (s) { return s.includes('/add-book/') })
    expect(addBookCalls.length).toBe(1)
    expect(addBookCalls[0]).toContain('/add-book/100')
  })

  it('requires --query, --current-page, or --book-id (rejects none)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createPageMock([])
    await expect(
      command.func(page, { name: 'My List' })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Requires/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('rejects --book-id with invalid value', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }]
    })
    await expect(
      command.func(page, { name: 'My List', 'book-id': 'not-valid' })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/must be a numeric book ID/)
    })
    // resolveBookSelector throws before any page calls
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('rejects --book-id with javascript: URL', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }]
    })
    await expect(
      command.func(page, { name: 'My List', 'book-id': 'javascript:alert(1)' })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/must be a numeric book ID/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('rejects --book-id when combined with --query', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createPageMock([])
    await expect(
      command.func(page, { name: 'My List', 'book-id': '123', query: 'python' })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/mutually exclusive/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('rejects --book-id when combined with --current-page', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createPageMock([])
    await expect(
      command.func(page, { name: 'My List', 'book-id': '123', 'current-page': true })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/mutually exclusive/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('rejects cross-origin absolute URL in --book-id', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-add')
    const page = createBooklistAddPage({
      booklists: [{ id: 1, title: 'My List', bookCount: 0 }],
      singleBook: {
        origin: 'https://frenchbooks.sk',
        extractedBookId: '' // should not be reached
      }
    })
    await expect(
      command.func(page, { name: 'My List', 'book-id': 'https://evil.com/book/12345' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/same-site|Expected origin/)
    })
    // No navigation happened — origin check failed before goto
    expect(page.goto).not.toHaveBeenCalled()
    // No add-book API calls were made
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const addBookCalls = scripts.filter(function (s) { return s.includes('/add-book/') })
    expect(addBookCalls.length).toBe(0)
  })
})
