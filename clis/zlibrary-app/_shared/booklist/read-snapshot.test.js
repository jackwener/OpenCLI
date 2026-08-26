/**
 * Tests for booklist read-flow shared acquisition kernel.
 *
 * Uses module-level vi.mock to isolate the snapshot kernel from API internals.
 * This keeps tests focused on kernel contract (entry resolution, enrichment,
 * scope routing, error handling) without dealing with the complex evaluate
 * call sequence inside getBooklistBooks().
 *
 * Integration between kernel and actual page evaluate calls is verified
 * through command-level tests (booklist-show, booklist-export).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageMock } from '../../../test-utils.js'

vi.mock('@jackwener/opencli/errors', () => {
  class CommandExecutionError extends Error {}
  class ArgumentError extends Error {}
  return { CommandExecutionError, ArgumentError }
})

// Mock API module to control what getBooklists / getBooklistInfo / etc return
vi.mock('./api.js', () => ({
  getBooklists: vi.fn(),
  getBooklistInfo: vi.fn(),
  getBooklistBooks: vi.fn(),
  getBooklistsFromTab: vi.fn(),
}))

import { getBooklists, getBooklistInfo, getBooklistBooks, getBooklistsFromTab } from './api.js'
import { readBooklistSnapshot } from './read-snapshot.js'

describe('readBooklistSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { entry, books, origin, warnings } shape for scope=my', async () => {
    getBooklists.mockResolvedValue([
      { id: 1, title: 'My List', description: '', bookCount: 5, createdAt: '2024-01-01' },
    ])
    getBooklistInfo.mockResolvedValue({ id: 1, title: 'My List', description: '', bookCount: 5, createdAt: '2024-01-01', accessType: 'private' })
    getBooklistBooks.mockResolvedValue([
      { bookId: '101', readlistBookId: '', title: 'Book A', author: 'Author A', language: 'en', extension: 'epub', size: '5 MB', url: 'https://z-lib.gl/book/101/a' },
    ])

    const page = createPageMock(['https://z-lib.gl'])

    const result = await readBooklistSnapshot(page, { name: 'My List' })

    expect(result).toHaveProperty('entry')
    expect(result.entry).toMatchObject({
      id: 1,
      title: 'My List',
      bookCount: 5,
      scope: 'my',
    })
    expect(typeof result.entry.createdAt).toBe('string')

    expect(result).toHaveProperty('books')
    expect(result.books).toHaveLength(1)
    expect(result.books[0]).toMatchObject({ bookId: '101', title: 'Book A' })

    expect(result.origin).toBe('https://z-lib.gl')
    expect(result.warnings).toEqual([])
  })

  it('throws CommandExecutionError when booklist not found in scope=my with DOM fallback', async () => {
    // API returns empty — no match
    getBooklists.mockResolvedValue([])
    // DOM fallback also returns empty
    getBooklistsFromTab.mockResolvedValue([])

    const page = createPageMock([])

    await expect(
      readBooklistSnapshot(page, { name: 'Nonexistent' })
    ).rejects.toThrow('not found')
  })

  it('returns empty books array for empty booklist', async () => {
    getBooklists.mockResolvedValue([
      { id: 1, title: 'Empty List', description: '', bookCount: 0, createdAt: '2024-01-01' },
    ])
    getBooklistInfo.mockResolvedValue({ id: 1, title: 'Empty List', description: '', bookCount: 0, createdAt: '2024-01-01' })
    getBooklistBooks.mockResolvedValue([])

    const page = createPageMock(['https://z-lib.gl'])

    const result = await readBooklistSnapshot(page, { name: 'Empty List' })
    expect(result.entry.bookCount).toBe(0)
    expect(result.books).toEqual([])
  })

  it('throws ArgumentError for empty name', async () => {
    const page = createPageMock([])
    await expect(
      readBooklistSnapshot(page, { name: '' })
    ).rejects.toThrow('name cannot be empty')
  })

  it('succeeds when metadata API returns 404 — entry still returned', async () => {
    getBooklists.mockResolvedValue([
      { id: 1, title: 'My List', description: '', bookCount: 5, createdAt: '2024-01-01' },
    ])
    // getBooklistInfo returns 404 wrapper — kernel should degrade to {}
    getBooklistInfo.mockResolvedValue({})
    getBooklistBooks.mockResolvedValue([
      { bookId: '101', readlistBookId: '', title: 'Book A', author: 'Author A' },
    ])

    const page = createPageMock(['https://z-lib.gl'])

    const result = await readBooklistSnapshot(page, { name: 'My List' })
    expect(result.entry).toMatchObject({ id: 1, title: 'My List', bookCount: 5 })
    expect(result.books).toHaveLength(1)
  })

  it('discovers public scope booklists via DOM tab', async () => {
    // scope=public: should use getBooklistsFromTab, not getBooklists
    getBooklistsFromTab.mockResolvedValue([
      { topic: 'Public List', href: '/booklist/2/hash/public.html', id: 2, bookCount: 3 },
    ])
    getBooklistBooks.mockResolvedValue([
      { bookId: '201', readlistBookId: '', title: 'Public Book', author: 'Author P' },
    ])

    const page = createPageMock(['https://z-lib.gl'])

    const result = await readBooklistSnapshot(page, { name: 'Public List', scope: 'public' })

    expect(result.entry).toMatchObject({ id: 2, title: 'Public List', bookCount: 3, scope: 'public' })
    expect(result.books).toHaveLength(1)
    // Must NOT call getBooklists (API) for non-my scope
    expect(getBooklists).not.toHaveBeenCalled()
    expect(getBooklistsFromTab).toHaveBeenCalledWith(expect.anything(), 'public')
  })

  it('discovers favorite scope booklists via DOM tab', async () => {
    getBooklistsFromTab.mockResolvedValue([
      { topic: 'Fav List', href: '/booklist/3/hash/fav.html', id: 3, bookCount: 7 },
    ])
    getBooklistBooks.mockResolvedValue([])

    const page = createPageMock(['https://z-lib.gl'])

    const result = await readBooklistSnapshot(page, { name: 'Fav List', scope: 'favorite' })

    expect(result.entry).toMatchObject({ id: 3, title: 'Fav List', bookCount: 7, scope: 'favorite' })
    expect(getBooklists).not.toHaveBeenCalled()
    expect(getBooklistsFromTab).toHaveBeenCalledWith(expect.anything(), 'favorite')
  })
})
