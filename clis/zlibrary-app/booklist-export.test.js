import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import {
  createBooklistExportPage,
  loadBooklistFixture,
  loadBookcardFixture,
  makeFixtureBooklists,
  makeFixtureBookRows,
  makeFixtureDetailEvals
} from './_shared/test/booklist-test-utils.js'
import './booklist-export.js'

// ---------------------------------------------------------------------------
// Mock node:fs for file operations
// ---------------------------------------------------------------------------

const { mockExistsSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      writeFileSync: mockWriteFileSync
    }
  }
})

const BOOKLIST_FIXTURE = loadBooklistFixture()
const BOOKLIST_SAMPLE_ROWS = makeFixtureBookRows(BOOKLIST_FIXTURE, { count: 2 })
const BOOKLIST_SAMPLE_BOOKLISTS = makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 2, createdAt: '2024-01-01' })
const DETAIL_EVALS_FOR_SAMPLE_ROWS = makeFixtureDetailEvals(BOOKLIST_SAMPLE_ROWS)

// ---------------------------------------------------------------------------
// Booklist Export — metadata API 404 degradation
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-export — metadata API 404', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockWriteFileSync.mockReset()
  })

  it('command is registered', () => {
    const cmd = getRegistry().get('zlibrary-app/booklist-export')
    expect(cmd).toBeDefined()
  })

  it('succeeds when metadata API returns 404 — preserves JSON schema', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(false)

    const page = createBooklistExportPage({
      booklists: BOOKLIST_SAMPLE_BOOKLISTS,
      infoResult: { error: 'HTTP 404: Not Found', _httpStatus: 404 },
      books: BOOKLIST_SAMPLE_ROWS,
    })

    const result = await command.func(page, { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title, file: '/tmp/export-404.json' })

    // Must still succeed
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ booklist: BOOKLIST_SAMPLE_BOOKLISTS[0].title })
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)

    const writeContent = mockWriteFileSync.mock.calls[0][1]
    const parsed = JSON.parse(writeContent)
    expect(parsed.booklist).toBe(BOOKLIST_SAMPLE_BOOKLISTS[0].title)
    expect(parsed.totalBooks).toBe(2)
    expect(parsed.books).toHaveLength(2)
    // URL must be absolute HTTP
    expect(parsed.books[0].url).toMatch(/^https?:\/\//)
  }, 15000)

  it('uses entry.booklistId when metadata 404s', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(false)

    const page = createBooklistExportPage({
      booklists: BOOKLIST_SAMPLE_BOOKLISTS,
      infoResult: { error: 'HTTP 404: Not Found', _httpStatus: 404 },
      books: BOOKLIST_SAMPLE_ROWS,
    })

    await command.func(page, { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title, file: '/tmp/export-404-id.json' })

    const writeContent = mockWriteFileSync.mock.calls[0][1]
    const parsed = JSON.parse(writeContent)
    // booklistId comes from entry (API discovery), not from enrichment
    expect(parsed.booklistId).toBe(BOOKLIST_SAMPLE_BOOKLISTS[0].id)
  }, 15000)
})

// ---------------------------------------------------------------------------
// Booklist Export — core behavior
// ---------------------------------------------------------------------------

describe('zlibrary-app booklist-export', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockWriteFileSync.mockReset()
  })

  it('exports books to a JSON file', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(false)

    const page = createBooklistExportPage({
      booklists: BOOKLIST_SAMPLE_BOOKLISTS,
      books: BOOKLIST_SAMPLE_ROWS
    })

    const result = await command.func(page, { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title, file: '/tmp/export.json' })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      booklist: BOOKLIST_SAMPLE_BOOKLISTS[0].title,
      exported: 2,
      file: '/tmp/export.json'
    })

    // Verify fs.writeFileSync was called with correct content
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const [writePath, writeContent, encoding] = mockWriteFileSync.mock.calls[0]
    expect(writePath).toBe('/tmp/export.json')
    expect(encoding).toBe('utf-8')

    const parsed = JSON.parse(writeContent)
    expect(parsed.booklist).toBe(BOOKLIST_SAMPLE_BOOKLISTS[0].title)
    expect(parsed.totalBooks).toBe(2)
    expect(parsed.books).toHaveLength(2)
    expect(parsed.books[0]).toMatchObject({ bookId: BOOKLIST_SAMPLE_ROWS[0].bookId, title: BOOKLIST_SAMPLE_ROWS[0].title, author: BOOKLIST_SAMPLE_ROWS[0].author })
    expect(parsed.books[1]).toMatchObject({ bookId: BOOKLIST_SAMPLE_ROWS[1].bookId, title: BOOKLIST_SAMPLE_ROWS[1].title, author: BOOKLIST_SAMPLE_ROWS[1].author })

    // Verify new metadata fields using fixture-derived values
    expect(parsed.books[0]).toMatchObject({ publisher: BOOKLIST_SAMPLE_ROWS[0].publisher, series: BOOKLIST_SAMPLE_ROWS[0].series, categories: BOOKLIST_SAMPLE_ROWS[0].categories })
    expect(parsed.books[1]).toMatchObject({ publisher: BOOKLIST_SAMPLE_ROWS[1].publisher, series: BOOKLIST_SAMPLE_ROWS[1].series, categories: BOOKLIST_SAMPLE_ROWS[1].categories })

    // Verify url is absolute HTTP and path matches fixture url_path
    const bookcardFixture = loadBookcardFixture()
    const firstUrlPath = bookcardFixture.results['bookcard-rows'].data[0].url_path
    expect(parsed.books[0].url).toMatch(/^https?:\/\//)
    expect(new URL(parsed.books[0].url).pathname).toBe(firstUrlPath)
    expect(parsed.books[1].url).toMatch(/^https?:\/\//)
    expect(new URL(parsed.books[1].url).pathname).toBe(bookcardFixture.results['bookcard-rows'].data[1].url_path)

    // Verify formatQualityRating preserved from DOM extraction
    expect(parsed.books[0].formatQualityRating).toBe(BOOKLIST_SAMPLE_ROWS[0].formatQualityRating)
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    await expect(
      command.func(createPageMock([]), { name: '', file: '/tmp/out.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('requires --file flag', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    await expect(
      command.func(createPageMock([]), { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title })
    ).rejects.toBeInstanceOf(ArgumentError)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('rejects export when output file already exists', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(true)
    await expect(
      command.func(createPageMock([]), { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title, file: '/tmp/exists.json' })
    ).rejects.toBeInstanceOf(ArgumentError)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('throws EmptyResultError if booklist has no books', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(false)

    const page = createBooklistExportPage({
      booklists: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 0, createdAt: '2024-01-01' }),
      books: []
    })

    await expect(
      command.func(page, { name: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 0, createdAt: '2024-01-01' })[0].title, file: '/tmp/empty.json' })
    ).rejects.toBeInstanceOf(EmptyResultError)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  }, 15000)

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-export')
    mockExistsSync.mockReturnValue(false)

    const page = createBooklistExportPage({
      booklists: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' }),
      books: makeFixtureBookRows(BOOKLIST_FIXTURE, { count: 1 })
    })

    const [row] = await command.func(page, { name: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' })[0].title, file: '/tmp/col.json' })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  describe('--detail flag', () => {
    it('enriches book metadata with detail page fields', async () => {
      const command = getRegistry().get('zlibrary-app/booklist-export')
      mockExistsSync.mockReturnValue(false)

      const page = createBooklistExportPage({
        booklists: BOOKLIST_SAMPLE_BOOKLISTS,
        books: BOOKLIST_SAMPLE_ROWS,
        detailExtraEvals: DETAIL_EVALS_FOR_SAMPLE_ROWS
      })

      const result = await command.func(page, { name: BOOKLIST_SAMPLE_BOOKLISTS[0].title, file: '/tmp/detail.json', detail: true })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        booklist: BOOKLIST_SAMPLE_BOOKLISTS[0].title,
        exported: 2,
        file: '/tmp/detail.json'
      })

      // Verify fs.writeFileSync was called
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const writeContent = mockWriteFileSync.mock.calls[0][1]
      const parsed = JSON.parse(writeContent)

      // Verify detail-enriched fields for book 0
      expect(parsed.books[0].publisher).toBe(BOOKLIST_SAMPLE_ROWS[0].publisher)
      expect(parsed.books[0].series).toBe(BOOKLIST_SAMPLE_ROWS[0].series)
      expect(parsed.books[0].categories).toBe(BOOKLIST_SAMPLE_ROWS[0].categories)
      // pages only available through --detail enrichment when source data has it;
      // fixture doesn't include this field (DOM extraction doesn't extract it)
      expect(parsed.books[0].pages).toBe(BOOKLIST_SAMPLE_ROWS[0].pages || undefined)
      expect(parsed.books[0].isbn10).toBe(BOOKLIST_SAMPLE_ROWS[0].isbn.replace(/[^0-9]/g, '').slice(-10))
      // volume only available through --detail enrichment when source data has it
      expect(parsed.books[0].volume).toBe(BOOKLIST_SAMPLE_ROWS[0].volume || undefined)
      expect(parsed.books[0].year).toBe(BOOKLIST_SAMPLE_ROWS[0].year)

      // Verify second book got its own enrichment
      expect(parsed.books[1].publisher).toBe(BOOKLIST_SAMPLE_ROWS[1].publisher)
      expect(parsed.books[1].series).toBe(BOOKLIST_SAMPLE_ROWS[1].series)
      expect(parsed.books[1].year).toBe(BOOKLIST_SAMPLE_ROWS[1].year)
    })

    it('continues export when detail enrichment fails', async () => {
      const command = getRegistry().get('zlibrary-app/booklist-export')
      mockExistsSync.mockReturnValue(false)

      const page = createBooklistExportPage({
        booklists: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' }),
        books: makeFixtureBookRows(BOOKLIST_FIXTURE, { count: 1 }),
        // Simulate cross-origin redirect: assertSameOriginNotLoginWall
        // evaluates window.location.href — returning a cross-origin URL
        // triggers CommandExecutionError caught by the try-catch.
        detailExtraEvals: ['https://evil.com/cross-origin']
      })

      const result = await command.func(page, { name: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' })[0].title, file: '/tmp/fail.json', detail: true })

      // Should still export successfully with the original data
      expect(result).toHaveLength(1)
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const writeContent = mockWriteFileSync.mock.calls[0][1]
      const parsed = JSON.parse(writeContent)
      expect(parsed.books).toHaveLength(1)
      expect(parsed.books[0].bookId).toBe(makeFixtureBookRows(BOOKLIST_FIXTURE, { count: 1 })[0].bookId)
    })

    it('does not enrich when --detail is not passed', async () => {
      const command = getRegistry().get('zlibrary-app/booklist-export')
      mockExistsSync.mockReturnValue(false)

      const page = createBooklistExportPage({
        booklists: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' }),
        books: makeFixtureBookRows(BOOKLIST_FIXTURE, { count: 1 })
      })

      await command.func(page, { name: makeFixtureBooklists(BOOKLIST_FIXTURE, { count: 1, bookCount: 1, createdAt: '2024-01-01' })[0].title, file: '/tmp/nodetail.json' })

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const writeContent = mockWriteFileSync.mock.calls[0][1]
      const parsed = JSON.parse(writeContent)

      // Without --detail, publisher/series/categories come from
      // DOM extraction (now included in fixture-derived getBooklistBooks data)
      expect(parsed.books[0].publisher).toBe(BOOKLIST_SAMPLE_ROWS[0].publisher)
      expect(parsed.books[0].series).toBe(BOOKLIST_SAMPLE_ROWS[0].series)
      expect(parsed.books[0].categories).toBe(BOOKLIST_SAMPLE_ROWS[0].categories)
      expect(parsed.books[0].volume).toBeUndefined()
      expect(parsed.books[0].pages).toBeUndefined()
    })
  })
})
