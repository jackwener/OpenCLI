import { describe, expect, it, beforeAll } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import { createBooklistManagePage } from './_shared/test/booklist-test-utils.js'
import './booklist-manage.js'

describe('zlibrary-app booklist-manage', () => {
  it('adds a book with --add-book-id', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'add-book-id',
      addResult: { readlistBookId: 42 }
    })
    const result = await command.func(page, { name: 'My List', 'add-book-id': '100' })
    expect(result[0]).toMatchObject({ operation: 'add-book-id', booklist: 'My List', bookId: '100', added: 1 })
  })

  it('add-book-id with fixture: api fail + dom present → api_failed_dom_passed', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const booklists = [{ id: 42, title: 'My List' }]
    const addResult = { error: 'HTTP 400: rate limit' }
    const domState = {
      urlOrigin: 'https://z-lib.gl',
      urlPath: '/booklist/42',
      targetBookId: '2316106',
      targetBookPresent: true,
      visibleTexts: ['Book added'],
      bookcardsCount: 5,
      errors: [],
    }

    const evals = [
      JSON.stringify(booklists),         // resolveBooklistByNameOrThrow → getBooklists
      JSON.stringify(addResult),         // addBookToBooklist
      'https://z-lib.gl',                // capture → getCurrentHttpOrigin
      'https://z-lib.gl',                // capture → resolveBooklistDetailUrl → getCurrentHttpOrigin
      '/booklist/42/hash/list.html',     // capture → resolveBooklistDetailUrl → findBooklistDetailHref
      'https://z-lib.gl/booklists/my?searchQuery=My%20List', // capture → assertSameOriginNotLoginWall after search
      'https://z-lib.gl/booklist/42/hash/list.html', // capture → assertSameOriginNotLoginWall
      domState,                           // captureManageDomState → DOM evaluate
    ]
    const page = createPageMock(evals)

    const result = await command.func(page, { name: 'My List', 'add-book-id': '2316106', fixture: true })
    expect(result[0]).toMatchObject({
      operation: 'add-book-id',
      booklist: 'My List',
      bookId: '2316106',
      added: 1,
      reason: 'api_failed_dom_passed: HTTP 400: HTTP 400: rate limit',
    })
  })

  it('add-book-id: api fail + book already in list → already_in_booklist', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'add-book-id',
      addResult: { error: 'HTTP 400: already in list' },
      mappings: [{ readlistBookId: 10, bookId: '2316106', title: 'My List' }],
    })
    const result = await command.func(page, { name: 'My List', 'add-book-id': '2316106' })
    expect(result[0]).toMatchObject({ operation: 'add-book-id', added: 1, reason: 'already_in_booklist' })
  })

  it('add-book-id must be a number', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'add-book-id',
      addResult: {}
    })
    await expect(
      command.func(page, { name: 'My List', 'add-book-id': 'abc' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('deletes a book with --delete-book-id', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'delete-book-id',
      readlistBookIdFromDom: '10',
      removeResult: { success: true }
    })
    const result = await command.func(page, { name: 'My List', 'delete-book-id': '100' })
    expect(result[0]).toMatchObject({ operation: 'delete-book-id', booklist: 'My List', bookId: '100', reason: '' })

    // Source-to-sink handoff contract: the remove call must use the
    // DOM-resolved readlistBookId (10), NEVER the user-supplied bookId (100).
    const removeScript = page.evaluate.mock.calls[page.evaluate.mock.calls.length - 1][0]
    expect(removeScript).toContain('/papi/booklist/1/remove-book/10')
    expect(removeScript).not.toContain('/remove-book/100')
  })

  it('delete returns not_found when bookId not in booklist', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'delete-book-id',
      readlistBookIdFromDom: null
    })
    const result = await command.func(page, { name: 'My List', 'delete-book-id': '999' })
    expect(result[0]).toMatchObject({ bookId: '999', reason: 'book_not_found_in_booklist' })
  })

  it('appends books with --append-query', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'append-query',
      mappings: [],
      searchResults: [
        { id: '100', title: 'Book A' },
        { id: '200', title: 'Book B' }
      ],
      addResponses: [
        { readlistBookId: 10 },
        { readlistBookId: 20 }
      ]
    })
    const result = await command.func(page, { name: 'My List', 'append-query': 'python' })
    expect(result[0]).toMatchObject({ operation: 'append-query', booklist: 'My List', added: 2, skipped: 0, total: 2 })
  })

  it('requires exactly one operation flag', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects multiple operation flags', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }]
    })
    await expect(
      command.func(page, { name: 'My List', 'add-book-id': '100', 'delete-book-id': '200' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('throws CommandExecutionError when name not found', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: []
    })
    await expect(
      command.func(page, { name: 'Nonexistent', 'add-book-id': '100' })
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'add-book-id',
      addResult: { readlistBookId: 42 }
    })
    const [row] = await command.func(page, { name: 'My List', 'add-book-id': '100' })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    await expect(
      command.func(createPageMock([]), { name: '' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('delete returns success with { success: 1 } API response', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'delete-book-id',
      readlistBookIdFromDom: '10',
      removeResult: { success: 1 }
    })
    const result = await command.func(page, { name: 'My List', 'delete-book-id': '100' })
    expect(result[0]).toMatchObject({ operation: 'delete-book-id', bookId: '100', reason: '' })
  })

  it('delete-book-id must be a number', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'delete-book-id',
      readlistBookIdFromDom: null
    })
    await expect(
      command.func(page, { name: 'My List', 'delete-book-id': 'abc' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('delete reports API error detail in reason', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-manage')
    const page = createBooklistManagePage({
      booklists: [{ id: 1, title: 'My List' }],
      operation: 'delete-book-id',
      readlistBookIdFromDom: '10',
      removeResult: { error: 'Book not removable' }
    })
    const result = await command.func(page, { name: 'My List', 'delete-book-id': '100' })
    expect(result[0]).toMatchObject({ reason: 'remove_failed: Book not removable' })
  })
})
