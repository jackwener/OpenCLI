import { describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError, EmptyResultError, LoginWallError } from '@jackwener/opencli/errors'
import fs from 'node:fs'
import { createPageMock } from '../test-utils.js'
import { createSearchCommandPage, DEFAULT_SEARCH_RESULT } from './_shared/test/test-utils-search.js'
import { filterByLanguage, filterByExtension, filterByContentType, filterByYearRange, filterByRegex, fetchAllPages } from './search.js'
import './search.js'

describe('zlibrary-app search', () => {
  it('returns parsed book results from extractSearchResults', async () => {
    const command = getRegistry().get('zlibrary-app/search')
    const page = createSearchCommandPage({
      results: [
        { ...DEFAULT_SEARCH_RESULT, rank: 1, title: 'Test Book', author: 'Test Author' },
        { ...DEFAULT_SEARCH_RESULT, rank: 2, title: 'Another Book', author: 'Another Author', id: '67890' }
      ]
    })

    const result = await command.func(page, { 'query': 'test', limit: 10 })

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ title: 'Test Book', author: 'Test Author', year: '2024', 'content-type': 'book' })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/search')
    const page = createSearchCommandPage({
      results: [{ ...DEFAULT_SEARCH_RESULT }]
    })
    const [row] = await command.func(page, { 'query': 'x', limit: 5 })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('all result urls are absolute HTTP(S) URLs', async () => {
    const command = getRegistry().get('zlibrary-app/search')
    const page = createSearchCommandPage({
      results: [
        { ...DEFAULT_SEARCH_RESULT, rank: 1 },
        { ...DEFAULT_SEARCH_RESULT, rank: 2 }
      ]
    })
    const results = await command.func(page, { 'query': 'test', limit: 10 })

    for (const row of results) {
      expect(row.url).toMatch(/^https?:\/\//)
    }
  })

  it('throws EmptyResultError when no results found', async () => {
    const command = getRegistry().get('zlibrary-app/search')
    const page = createSearchCommandPage({ results: [] })

    await expect(
      command.func(page, { 'query': 'nonexistent', limit: 10 })
    ).rejects.toBeInstanceOf(EmptyResultError)
  })

  describe('filterByLanguage', () => {
    it('filters results by a single language', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, title: 'English Book', language: 'English' },
        { ...DEFAULT_SEARCH_RESULT, title: 'Japanese Book', language: 'Japanese' },
        { ...DEFAULT_SEARCH_RESULT, title: 'Chinese Book', language: 'Chinese' }
      ]
      expect(filterByLanguage(results, ['ja'])).toHaveLength(1)
      expect(filterByLanguage(results, ['ja'])[0].title).toBe('Japanese Book')
    })

    it('filters by multiple languages', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, title: 'English Book', language: 'English' },
        { ...DEFAULT_SEARCH_RESULT, title: 'Japanese Book', language: 'Japanese' },
        { ...DEFAULT_SEARCH_RESULT, title: 'Chinese Book', language: 'Chinese' }
      ]
      expect(filterByLanguage(results, ['en', 'ja'])).toHaveLength(2)
    })

    it('returns all results when no languages specified', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT }, { ...DEFAULT_SEARCH_RESULT }]
      expect(filterByLanguage(results, [])).toHaveLength(2)
      expect(filterByLanguage(results, null)).toHaveLength(2)
      expect(filterByLanguage(results, undefined)).toHaveLength(2)
    })

  })

  describe('filterByExtension', () => {
    it('filters by single extension', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, extension: 'pdf' },
        { ...DEFAULT_SEARCH_RESULT, extension: 'epub' }
      ]
      expect(filterByExtension(results, ['pdf'])).toHaveLength(1)
    })

    it('filters by multiple extensions', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, extension: 'pdf' },
        { ...DEFAULT_SEARCH_RESULT, extension: 'epub' },
        { ...DEFAULT_SEARCH_RESULT, extension: 'mobi' }
      ]
      expect(filterByExtension(results, ['pdf', 'mobi'])).toHaveLength(2)
    })

    it('is case-insensitive', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT, extension: 'PDF' }]
      expect(filterByExtension(results, ['pdf'])).toHaveLength(1)
    })

    it('returns all when no extensions given', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT }]
      expect(filterByExtension(results, [])).toHaveLength(1)
      expect(filterByExtension(results, null)).toHaveLength(1)
    })
  })

  describe('filterByContentType', () => {
    it('filters by book content type', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, contentType: 'book' },
        { ...DEFAULT_SEARCH_RESULT, contentType: 'article' }
      ]
      expect(filterByContentType(results, ['book'])).toHaveLength(1)
    })

    it('is case-insensitive', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT, contentType: 'BOOK' }]
      expect(filterByContentType(results, ['book'])).toHaveLength(1)
    })

    it('returns all when no types given', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT }]
      expect(filterByContentType(results, [])).toHaveLength(1)
      expect(filterByContentType(results, null)).toHaveLength(1)
    })
  })

  describe('filterByYearRange', () => {
    it('filters by year range inclusive', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, year: '2020' },
        { ...DEFAULT_SEARCH_RESULT, year: '2021' },
        { ...DEFAULT_SEARCH_RESULT, year: '2022' },
        { ...DEFAULT_SEARCH_RESULT, year: '2023' }
      ]
      expect(filterByYearRange(results, 2021, 2022)).toHaveLength(2)
    })

    it('filters by from only', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, year: '2020' },
        { ...DEFAULT_SEARCH_RESULT, year: '2022' }
      ]
      expect(filterByYearRange(results, 2021, undefined)).toHaveLength(1)
      expect(filterByYearRange(results, 2021, null)).toHaveLength(1)
    })

    it('filters by to only', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, year: '2020' },
        { ...DEFAULT_SEARCH_RESULT, year: '2022' }
      ]
      expect(filterByYearRange(results, undefined, 2021)).toHaveLength(1)
    })

    it('returns all when no range given', () => {
      const results = [{ ...DEFAULT_SEARCH_RESULT }]
      expect(filterByYearRange(results, null, null)).toHaveLength(1)
    })

    it('keeps rows with non-numeric years when filtering by range', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, year: '' },
        { ...DEFAULT_SEARCH_RESULT, year: 'unknown' }
      ]
      expect(filterByYearRange(results, 2020, 2025)).toHaveLength(2)
    })
  })

  describe('filterByRegex', () => {
    it('supports unicode regex matching', () => {
      const results = [
        { ...DEFAULT_SEARCH_RESULT, title: '算法导论', author: 'Thomas', publisher: 'MIT Press' },
        { ...DEFAULT_SEARCH_RESULT, title: 'Война и мир', author: 'Лев Толстой', publisher: 'Русский Вестник' }
      ]
      expect(filterByRegex(results, '算法', '', '')).toHaveLength(1)
      expect(filterByRegex(results, '', 'толстой', '')).toHaveLength(1)
    })
  })

  describe('pagination (fetchAllPages)', () => {
    it('aggregates results from multiple pages', async () => {
      const page1 = Array.from({ length: 50 }, function (_, i) {
        return { ...DEFAULT_SEARCH_RESULT, rank: i + 1, title: 'Page1 Book ' + (i + 1), id: String(i + 1) }
      })
      const pageEvaluate = vi.fn()
        .mockResolvedValueOnce(JSON.stringify(page1))
        .mockResolvedValueOnce(JSON.stringify([
          { ...DEFAULT_SEARCH_RESULT, rank: 1, title: 'Page2 Book', id: '51' }
        ]))

      const page = createPageMock([], { evaluate: pageEvaluate })
      const results = await fetchAllPages(page, 'test', 5)

      expect(results).toHaveLength(51)
      expect(results[0]).toMatchObject({ title: 'Page1 Book 1' })
      expect(results[50]).toMatchObject({ title: 'Page2 Book' })
      expect(page.goto).toHaveBeenCalledTimes(2)
    })

    it('stops when a page returns no results', async () => {
      const pageEvaluate = vi.fn()
        .mockResolvedValueOnce(JSON.stringify([]))

      const page = createPageMock([], { evaluate: pageEvaluate })
      const results = await fetchAllPages(page, 'test', 5)

      expect(results).toEqual([])
      expect(page.goto).toHaveBeenCalledTimes(1)
    })
  })

  describe('CLI argument validation', () => {
    it('primary required argument "query" is positional (upstream arg convention)', () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const queryArg = cmd.args.find(a => a.name === 'query')
      expect(queryArg).toBeDefined()
      expect(queryArg.required).toBe(true)
      expect(queryArg.positional).toBe(true)
    })

    it('default limit is 50', () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const limitArg = cmd.args.find(a => a.name === 'limit')
      expect(limitArg).toBeDefined()
      expect(limitArg.default).toBe(50)
    })

    it('accepts canonical --filter-lang-codes, --filter-ext, --filter-content-type, --filter-year-from, --filter-year-to args', () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const argNames = cmd.args.map(a => a.name)
      expect(argNames).toContain('filter-lang-codes')
      expect(argNames).toContain('filter-ext')
      expect(argNames).toContain('filter-content-type')
      expect(argNames).toContain('filter-year-from')
      expect(argNames).toContain('filter-year-to')
      expect(argNames).toContain('filter-exact-matching')
      expect(argNames).toContain('filter-regex-title')
      expect(argNames).toContain('filter-regex-author')
      expect(argNames).toContain('filter-regex-publisher')
      // Deprecated flags have been removed
      expect(argNames).not.toContain('language')
      expect(argNames).not.toContain('extension')
      expect(argNames).not.toContain('content-type')
      expect(argNames).not.toContain('year-from')
      expect(argNames).not.toContain('year-to')
    })

    it('throws ArgumentError for invalid --filter-regex-title', async () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })
      await expect(
        cmd.func(page, { 'query': 'x', 'filter-regex-title': '[abc' })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('throws ArgumentError when --filter-regex-title has no value', async () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })
      await expect(
        cmd.func(page, { 'query': 'x', 'filter-regex-title': true })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('rejects --limit below 1', async () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })
      await expect(
        cmd.func(page, { 'query': 'x', limit: 0 })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('rejects --limit above 50', async () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })
      await expect(
        cmd.func(page, { 'query': 'x', limit: 999 })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('declared columns do not include filename (conditional)', () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      // Columns are fixed; filename is conditional via --filename-template (not in columns)
      expect(cmd.columns).toEqual(
        ['rank', 'title', 'author', 'year', 'language', 'language-code', 'extension', 'content-type', 'size', 'url', 'id', 'quality-rating', 'format-quality-rating', 'favorite', 'booklist', 'downloaded', 'publisher', 'isbn', 'pages', 'isbn-10', 'isbn-13', 'series', 'volume', 'categories', 'description', 'meta-description', 'detail-error']
      )
    })

    it('rejects invalid filter options at the parse boundary', async () => {
      const cmd = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })

      await expect(cmd.func(page, { 'query': 'x', 'filter-lang-codes': 'xx' })).rejects.toBeInstanceOf(ArgumentError)
      await expect(cmd.func(page, { 'query': 'x', 'filter-ext': 'exe' })).rejects.toBeInstanceOf(ArgumentError)
      await expect(cmd.func(page, { 'query': 'x', 'filter-content-type': 'video' })).rejects.toBeInstanceOf(ArgumentError)
      await expect(cmd.func(page, { 'query': 'x', 'filter-year-from': 'later' })).rejects.toBeInstanceOf(ArgumentError)
      await expect(cmd.func(page, { 'query': 'x', 'filter-year-from': 2025, 'filter-year-to': 2020 })).rejects.toBeInstanceOf(ArgumentError)
    })

    it('--unlimited warning mentions --filter-year-from/--filter-year-to, not --filter-year-range', async () => {
      // Read the source and verify the warning string references the correct flags
      const source = fs.readFileSync(new URL('./search.js', import.meta.url), 'utf-8')
      // The warning must mention the actual canonical flag names
      expect(source).toMatch(/filter-year-from.*filter-year-to/)
      expect(source).not.toMatch(/filter-year-range/)
    })
  })

  describe('filterByLanguage — cross-boundary validation', () => {
    it('filterByLanguage with unknown ISO code returns []', () => {
      const sample = [
        { ...DEFAULT_SEARCH_RESULT, language: 'English' },
        { ...DEFAULT_SEARCH_RESULT, language: 'Japanese' }
      ]
      expect(filterByLanguage(sample, ['xx'])).toEqual([])
    })

    it('filterByLanguage with mixed valid+invalid codes still filters', () => {
      const sample = [
        { ...DEFAULT_SEARCH_RESULT, language: 'English' },
        { ...DEFAULT_SEARCH_RESULT, language: 'Japanese' },
        { ...DEFAULT_SEARCH_RESULT, language: 'Chinese' }
      ]
      const filtered = filterByLanguage(sample, ['en', 'xx'])
      expect(filtered).toHaveLength(1)
      expect(filtered[0].language).toBe('English')
    })
  })

  describe('URL trust boundary', () => {
    it('rejects file:// origin before navigation', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ origin: 'file:///path/to/app/dist/index.html' })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      // Security: no navigation or extraction after boundary failure
      expect(page.goto).not.toHaveBeenCalled()
    })

    it('rejects empty/null origin before navigation', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ origin: '' })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      expect(page.goto).not.toHaveBeenCalled()
    })

    it('rejects javascript: scheme origin before navigation', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ origin: 'javascript:void(0)' })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      expect(page.goto).not.toHaveBeenCalled()
    })

    it('rejects about:blank origin before navigation', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ origin: 'null' })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      expect(page.goto).not.toHaveBeenCalled()
    })

    it('rejects cross-origin redirect after navigation', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      // Origin is z-lib.sk but final URL redirects to evil.com
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://evil.com/s/test',
        results: []
      })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      // Navigation happened but extraction should not proceed
      // (the error is thrown after goto but before extractSearchResults)
    })

    it('allows same-origin navigation and returns results', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://z-lib.sk/s/test',
        results: [{ ...DEFAULT_SEARCH_RESULT }]
      })

      const result = await command.func(page, { query: 'test', limit: 10 })
      expect(result).toHaveLength(1)
      expect(page.goto).toHaveBeenCalledWith(
        'https://z-lib.sk/s/test',
        expect.objectContaining({ waitUntil: 'load' })
      )
    })

    it('rejects invalid origin before --unlimited pagination', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ origin: 'file:///path/to/shell.html' })

      await expect(
        command.func(page, { query: 'test', unlimited: true })
      ).rejects.toBeInstanceOf(CommandExecutionError)

      // Security: no pagination when origin is invalid
      expect(page.goto).not.toHaveBeenCalled()
    })
  })

  describe('login wall detection', () => {
    it('throws LoginWallError for /login final URL', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://z-lib.sk/login',
        results: []
      })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(LoginWallError)
    })

    it('throws LoginWallError for /login/ subpath', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://z-lib.sk/login/signin',
        results: []
      })

      await expect(
        command.func(page, { query: 'test', limit: 10 })
      ).rejects.toBeInstanceOf(LoginWallError)
    })

    it('does NOT throw LoginWallError for /book/login-required-title URL', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://z-lib.sk/book/login-required-title',
        results: [{ ...DEFAULT_SEARCH_RESULT }]
      })

      // This should NOT throw LoginWallError — /book/login-required-title is not a login wall
      const result = await command.func(page, { query: 'test', limit: 10 })
      expect(result).toHaveLength(1)
    })

    it('LoginWallError has correct exit code (77 = NOPERM)', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        href: 'https://z-lib.sk/login',
        results: []
      })

      try {
        await command.func(page, { query: 'test', limit: 10 })
        expect.unreachable('Should have thrown LoginWallError')
      } catch (err) {
        expect(err).toBeInstanceOf(LoginWallError)
        expect(err.exitCode).toBe(77)
      }
    })
  })

  describe('--detail flag', () => {
    it('enriches results with detail attributes when --detail is set', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        results: [{ ...DEFAULT_SEARCH_RESULT, rank: 1 }],
         detailResults: [{
          pages: '350',
          isbn10: '1234567890',
          isbn13: '9781234567890',
          series: 'The Great Series',
          volume: 'Vol. 3',
          categories: 'Fiction, Mystery',
          description: 'A detailed description.',
        }]
      })

      const result = await command.func(page, { 'query': 'test', limit: 10, detail: true })

      expect(result).toHaveLength(1)
      expect(result[0].pages).toBe('350')
      expect(result[0]['isbn-10']).toBe('1234567890')
      expect(result[0]['isbn-13']).toBe('9781234567890')
      expect(result[0].series).toBe('The Great Series')
      expect(result[0].volume).toBe('Vol. 3')
      expect(result[0].categories).toBe('Fiction, Mystery')
      expect(result[0].description).toBe('A detailed description.')
      expect(result[0]['detail-error']).toBeNull()
    })

    it('sets detail-error on per-row enrichment failure', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      // Detail extraction throws by not providing enough evaluate results
      // The page.goto will resolve, but the evaluate for detail will be out of results
      const page = createSearchCommandPage({
        results: [{ ...DEFAULT_SEARCH_RESULT, rank: 1 }],
        // No detailResults provided — evaluate will be undefined/json parse failure
      })

      // When detail extraction fails, detail-error is set
      const result = await command.func(page, { 'query': 'test', limit: 10, detail: true })

      expect(result).toHaveLength(1)
      expect(result[0]['detail-error']).toBeTruthy()
      // Base fields should still be present
      expect(result[0].title).toBe('Test Book')
      expect(result[0].url).toBe('https://z-lib.sk/book/1')
    })

    it('sets detail-error for rows without url field', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        results: [{ ...DEFAULT_SEARCH_RESULT, rank: 1, url: '' }],
      })

      const result = await command.func(page, { 'query': 'test', limit: 10, detail: true })

      expect(result).toHaveLength(1)
      expect(result[0]['detail-error']).toBe('no url')
    })

    it('declared columns match returned object keys with --detail', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        results: [{ ...DEFAULT_SEARCH_RESULT }],
         detailResults: [{
          pages: '',
          isbn10: '',
          isbn13: '',
          series: '',
          volume: '',
          categories: '',
          description: '',
        }]
      })
      const [row] = await command.func(page, { 'query': 'x', limit: 5, detail: true })
      const returnedKeys = Object.keys(row).sort()
      const declaredColumns = [...command.columns].sort()
      expect(returnedKeys).toEqual(declaredColumns)
    })

    it('rejects --detail with --unlimited', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })

      await expect(
        command.func(page, { 'query': 'x', detail: true, unlimited: true })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('sets detail-error for cross-origin row URL (P2 url pre-validation)', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({
        origin: 'https://z-lib.sk',
        results: [{ ...DEFAULT_SEARCH_RESULT, url: 'https://evil.com/book/999' }],
      })

      const result = await command.func(page, { query: 'test', limit: 10, detail: true })

      expect(result).toHaveLength(1)
      expect(result[0]['detail-error']).toBeTruthy()
      expect(result[0]['detail-error']).toMatch(/same-origin/)
      // Verify no navigation to the cross-origin URL
      expect(page.goto).not.toHaveBeenCalledWith('https://evil.com/book/999', expect.any(Object))
    })
  })

  describe('query validation (P3)', () => {
    it('throws ArgumentError for blank query string', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })

      await expect(
        command.func(page, { 'query': '', limit: 10 })
      ).rejects.toBeInstanceOf(ArgumentError)
    })

    it('throws ArgumentError for whitespace-only query', async () => {
      const command = getRegistry().get('zlibrary-app/search')
      const page = createSearchCommandPage({ results: [] })

      await expect(
        command.func(page, { 'query': '   ', limit: 10 })
      ).rejects.toBeInstanceOf(ArgumentError)
    })
  })
})
