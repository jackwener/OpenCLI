import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import {
  createBooklistImportPage,
  loadBooklistFixture,
  makeFixtureBooklists,
  makeFixtureBookRows
} from './_shared/test/booklist-test-utils.js'
import './booklist-import.js'

// ---------------------------------------------------------------------------
// Mock node:fs for file operations
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  // Delegate fixture file reads to the real implementation so loadBooklistFixture()
  // and loadBookcardFixture() can read committed fixture JSON files; non-fixture reads
  // go through mockReadFileSync which tests control for import file simulation.
  const delegatedReadFileSync = vi.fn((path, ...args) => {
    if (typeof path === 'string' && (path.includes('fixture/booklist-') || path.includes('fixture/bookcard-'))) {
      return actual.readFileSync(path, ...args)
    }
    return mockReadFileSync(path, ...args)
  })
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: delegatedReadFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: delegatedReadFileSync
    }
  }
})

// ---------------------------------------------------------------------------
// Booklist Import — core behavior
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-import', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
  })

  const fixture = loadBooklistFixture()
  const sourceBooks = makeFixtureBookRows(fixture, { count: 2 })
  const sourceBooklist = makeFixtureBooklists(fixture, { count: 1, bookCount: sourceBooks.length, createdAt: '2024-01-01' })[0]

  it('imports books from a JSON file into an existing booklist', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      booklist: sourceBooklist.title,
      books: sourceBooks.map(function (book) {
        return { bookId: String(book.bookId), title: book.title, author: book.author }
      })
    }))

    const page = createBooklistImportPage({
      booklists: makeFixtureBooklists(fixture, { count: 1, bookCount: sourceBooks.length, createdAt: '2024-01-01' }),
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: sourceBooks[0].bookId } },
        { success: 1, book: { id: '20', readlist_id: 1, book_id: sourceBooks[1].bookId } }
      ]
    })

    const result = await command.func(page, { name: sourceBooklist.title, file: '/tmp/import.json' })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      booklist: sourceBooklist.title,
      added: 2,
      skipped: 0,
      total: 2,
      file: '/tmp/import.json'
    })
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    await expect(
      command.func(createPageMock([]), { name: '', file: '/tmp/in.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('requires --file flag', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    await expect(
      command.func(createPageMock([]), { name: sourceBooklist.title })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects nonexistent input file', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(false)
    await expect(
      command.func(createPageMock([]), { name: sourceBooklist.title, file: '/tmp/nonexist.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects invalid JSON in the input file', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not valid json')
    await expect(
      command.func(createPageMock([]), { name: sourceBooklist.title, file: '/tmp/bad.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects file without books array', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ booklist: sourceBooklist.title, notBooks: [] }))
    await expect(
      command.func(createPageMock([]), { name: sourceBooklist.title, file: '/tmp/nobooks.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('throws EmptyResultError if no valid book IDs found', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      booklist: sourceBooklist.title,
      books: []
    }))
    await expect(
      command.func(createPageMock([]), { name: sourceBooklist.title, file: '/tmp/empty.json' })
    ).rejects.toBeInstanceOf(EmptyResultError)
  })

  it('deduplicates books already in the target booklist', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      booklist: sourceBooklist.title,
      books: sourceBooks.map(function (book) {
        return { bookId: String(book.bookId), title: book.title }
      })
    }))

    // Book 100 is already in the target booklist
    const page = createBooklistImportPage({
      booklists: makeFixtureBooklists(fixture, { count: 1, bookCount: sourceBooks.length, createdAt: '2024-01-01' }),
      existingMappings: [{ bookId: String(sourceBooks[0].bookId), readlistBookId: 1 }],
      addResponses: [
        { success: 1, book: { id: '20', readlist_id: 1, book_id: sourceBooks[1].bookId } }
      ]
    })

    const result = await command.func(page, { name: sourceBooklist.title, file: '/tmp/dedup.json' })
    expect(result[0]).toMatchObject({ added: 1, skipped: 1, total: 2 })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-import')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      booklist: sourceBooklist.title,
      books: [{ bookId: String(sourceBooks[0].bookId), title: sourceBooks[0].title, author: sourceBooks[0].author }]
    }))

    const page = createBooklistImportPage({
      booklists: makeFixtureBooklists(fixture, { count: 1, bookCount: sourceBooks.length, createdAt: '2024-01-01' }),
      existingMappings: [],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 1, book_id: sourceBooks[0].bookId } }
      ]
    })

    const [row] = await command.func(page, { name: sourceBooklist.title, file: '/tmp/col.json' })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })
})
