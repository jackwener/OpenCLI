/**
 * Unit tests for the pure search-pipeline module.
 *
 * Verifies that filter functions and pagination helpers work correctly
 * without any command registration side-effects.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPageMock } from '../../../test-utils.js'

vi.mock('@jackwener/opencli/errors', () => {
  class LoginWallError extends Error {}
  class CommandExecutionError extends Error {}
  class ArgumentError extends Error {}
  return { LoginWallError, CommandExecutionError, ArgumentError }
})

import {
  filterByLanguage,
  filterByLanguageNames,
  filterByExtension,
  filterByContentType,
  filterByYearRange,
  filterByRegex,
  fetchAllPages,
  buildFilterQueryString,
  toArray,
  assertKnownValues,
  collectSearchResultsPage
} from './search-pipeline.js'

describe('search-pipeline filterByLanguage', () => {
  it('filters by ISO code', () => {
    const results = [
      { language: 'English' },
      { language: 'Japanese' },
      { language: 'Chinese' }
    ]
    expect(filterByLanguage(results, ['ja'])).toHaveLength(1)
    expect(filterByLanguage(results, ['ja'])[0].language).toBe('Japanese')
  })

  it('filters by multiple codes', () => {
    const results = [
      { language: 'English' },
      { language: 'Japanese' },
      { language: 'Chinese' }
    ]
    expect(filterByLanguage(results, ['en', 'ja'])).toHaveLength(2)
  })

  it('filters by tw code for Traditional Chinese', () => {
    const results = [
      { language: 'Traditional Chinese' }
    ]
    expect(filterByLanguage(results, ['tw'])).toHaveLength(1)
  })

  it('returns all when no filter specified', () => {
    const results = [{ language: 'English' }, { language: 'Japanese' }]
    expect(filterByLanguage(results, [])).toHaveLength(2)
    expect(filterByLanguage(results, null)).toHaveLength(2)
  })

  it('returns empty for unknown code', () => {
    const results = [{ language: 'English' }]
    expect(filterByLanguage(results, ['xx'])).toHaveLength(0)
  })
})

describe('search-pipeline filterByExtension', () => {
  it('filters by extension', () => {
    const results = [{ extension: 'pdf' }, { extension: 'epub' }]
    expect(filterByExtension(results, ['pdf'])).toHaveLength(1)
  })

  it('is case-insensitive', () => {
    const results = [{ extension: 'PDF' }]
    expect(filterByExtension(results, ['pdf'])).toHaveLength(1)
  })
})

describe('search-pipeline filterByContentType', () => {
  it('filters by content type', () => {
    const results = [{ contentType: 'book' }, { contentType: 'article' }]
    expect(filterByContentType(results, ['book'])).toHaveLength(1)
  })
})

describe('search-pipeline filterByYearRange', () => {
  it('filters by from and to', () => {
    const results = [
      { year: '2020' },
      { year: '2021' },
      { year: '2022' }
    ]
    expect(filterByYearRange(results, 2021, 2022)).toHaveLength(2)
  })

  it('filters by from only', () => {
    const results = [{ year: '2020' }, { year: '2022' }]
    expect(filterByYearRange(results, 2021, null)).toHaveLength(1)
  })

  it('keeps rows with unknown year when filtering by upper bound', () => {
    const results = [
      { title: 'Unknown empty', year: '' },
      { title: 'Unknown missing' },
      { title: 'Known inside', year: '1996' },
      { title: 'Known outside', year: '2001' }
    ]
    const filtered = filterByYearRange(results, null, 2000)
    expect(filtered.map(function (r) { return r.title })).toEqual([
      'Unknown empty',
      'Unknown missing',
      'Known inside'
    ])
  })

  it('keeps rows with unknown year when filtering by lower bound', () => {
    const results = [
      { title: 'Unknown', year: '' },
      { title: 'Too old', year: '1999' },
      { title: 'Inside', year: '2001' }
    ]
    expect(filterByYearRange(results, 2000, null).map(function (r) { return r.title })).toEqual([
      'Unknown',
      'Inside'
    ])
  })
})

describe('search-pipeline fetchAllPages', () => {
  it('aggregates results from multiple pages', async () => {
    const page1 = Array.from({ length: 50 }, function (_, i) {
      return { rank: i + 1, title: 'Page1 Book ' + (i + 1), id: String(i + 1), url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const page2 = [
      { rank: 1, title: 'Page2 Book', id: '51', url: 'https://z-lib.gl/book/51' }
    ]
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(page1))
      .mockResolvedValueOnce(JSON.stringify(page2))

    const page = createPageMock([], { evaluate: pageEvaluate })
    const results = await fetchAllPages(page, 'test', 5)

    expect(results).toHaveLength(51)
    expect(results[0].title).toBe('Page1 Book 1')
    expect(results[49].title).toBe('Page1 Book 50')
    expect(results[50].title).toBe('Page2 Book')
    expect(page.goto).toHaveBeenCalledTimes(2)
  })

  it('stops when a page returns no results', async () => {
    const pageEvaluate = vi.fn().mockResolvedValueOnce(JSON.stringify([]))
    const page = createPageMock([], { evaluate: pageEvaluate })
    const results = await fetchAllPages(page, 'test', 5)
    expect(results).toEqual([])
    expect(page.goto).toHaveBeenCalledTimes(1)
  })

  it('constructs absolute URLs when origin is provided', async () => {
    // Verify that fetchAllPages uses origin-prefixed URLs for goto
    // when the origin parameter is provided.
    // When origin is provided, fetchAllPages also validates same-origin
    // after each goto via page.evaluate('window.location.href').
    // We provide a valid same-origin URL for that check.
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce('https://z-lib.sk/s/test?page=1')  // location.href (same-origin check)
      .mockResolvedValueOnce(JSON.stringify([]))  // extractSearchResults returns empty → stops

    const page = createPageMock([], { evaluate: pageEvaluate })
    await fetchAllPages(page, 'test', 5, 'https://z-lib.sk')

    // Verify it used absolute URL (origin + path) for goto
    expect(page.goto).toHaveBeenCalledWith(
      'https://z-lib.sk/s/test?page=1',
      expect.objectContaining({ waitUntil: 'load' })
    )
  })

  it('constructs relative URLs when origin is omitted', async () => {
    // Without origin, fetchAllPages uses relative paths (backward compat)
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([]))  // extractSearchResults returns empty → stops

    const page = createPageMock([], { evaluate: pageEvaluate })
    await fetchAllPages(page, 'test', 5)

    // Verify it used relative URL (no origin prefix) for goto
    expect(page.goto).toHaveBeenCalledWith(
      '/s/test?page=1',
      expect.objectContaining({ waitUntil: 'load' })
    )
  })

  it('appends filter query string to pagination URLs', async () => {
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce('https://z-lib.sk/s/test?languages[]=japanese&page=1')  // location.href (same-origin)
      .mockResolvedValueOnce(JSON.stringify([]))  // empty results → stops

    const page = createPageMock([], { evaluate: pageEvaluate })
    await fetchAllPages(page, 'test', 5, 'https://z-lib.sk', '?languages[]=japanese')

    // Verify filter query string is inserted before &page=N
    expect(page.goto).toHaveBeenCalledWith(
      'https://z-lib.sk/s/test?languages[]=japanese&page=1',
      expect.objectContaining({ waitUntil: 'load' })
    )
  })

  it('stops when next page has no new IDs', async () => {
    const page1 = Array.from({ length: 50 }, function (_, i) {
      return { rank: i + 1, title: 'Book ' + (i + 1), id: String(i + 1), url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const page2 = Array.from({ length: 50 }, function (_, i) {
      return { rank: i + 1, title: 'Book ' + (i + 1) + ' duplicate', id: String(i + 1), url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(page1))
      .mockResolvedValueOnce(JSON.stringify(page2))

    const page = createPageMock([], { evaluate: pageEvaluate })
    const results = await fetchAllPages(page, 'test', 5)

    expect(results).toHaveLength(50)
    expect(results[0].id).toBe('1')
    expect(page.goto).toHaveBeenCalledTimes(2)
  })

  it('deduplicates numeric and string IDs via String(id)', async () => {
    const page1 = Array.from({ length: 50 }, function (_, i) {
      return { rank: i + 1, title: 'Book ' + (i + 1), id: i + 1, url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const page2 = Array.from({ length: 50 }, function (_, i) {
      return { rank: i + 1, title: 'Book ' + (i + 1) + ' duplicate', id: String(i + 1), url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const pageEvaluate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(page1))
      .mockResolvedValueOnce(JSON.stringify(page2))

    const page = createPageMock([], { evaluate: pageEvaluate })
    const results = await fetchAllPages(page, 'test', 5)

    expect(results).toHaveLength(50)
    expect(results[0].id).toBe(1)
    expect(page.goto).toHaveBeenCalledTimes(2)
  })

  it('stops after first page when page is partial (< 50 rows)', async () => {
    const rows = Array.from({ length: 49 }, function (_, i) {
      return { rank: i + 1, title: 'Book ' + (i + 1), id: String(i + 1), url: 'https://z-lib.gl/book/' + (i + 1) }
    })
    const pageEvaluate = vi.fn().mockResolvedValueOnce(JSON.stringify(rows))

    const page = createPageMock([], { evaluate: pageEvaluate })
    const results = await fetchAllPages(page, 'test', 5)

    expect(results).toHaveLength(49)
    expect(page.goto).toHaveBeenCalledTimes(1)
  })
})

describe('search-pipeline collectSearchResultsPage validation', () => {
  it('rejects invalid startOrigin shape before navigation', async () => {
    const page = createPageMock([])

    await expect(
      collectSearchResultsPage(page, 'https://z-lib.sk', 'test')
    ).rejects.toThrow(/startOrigin object with origin string/i)

    expect(page.goto).not.toHaveBeenCalled()
  })
})

describe('search-pipeline buildFilterQueryString', () => {
  const LANGUAGE_BY_CODE = new Map([
    ['en', 'English'],
    ['ja', 'Japanese'],
    ['zh', 'Chinese'],
    ['fr', 'French'],
    ['de', 'German']
  ])

  it('returns empty string when no filters', () => {
    const result = buildFilterQueryString([], [], [], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('')
  })

  it('returns empty string when all filters are null/undefined', () => {
    const result = buildFilterQueryString(null, null, null, null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('')
  })

  it('builds languages[] param from ISO code', () => {
    const result = buildFilterQueryString(['ja'], [], [], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?languages[]=japanese')
  })

  it('builds multiple languages[] params', () => {
    const result = buildFilterQueryString(['en', 'ja'], [], [], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?languages[]=english&languages[]=japanese')
  })

  it('skips unknown ISO codes silently', () => {
    const result = buildFilterQueryString(['xx', 'en'], [], [], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?languages[]=english')
  })

  it('builds extensions[] params in UPPERCASE', () => {
    const result = buildFilterQueryString([], ['pdf', 'epub'], [], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?extensions[]=PDF&extensions[]=EPUB')
  })

  it('builds selected_content_types[] param', () => {
    const result = buildFilterQueryString([], [], ['book'], null, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?selected_content_types[]=book')
  })

  it('builds yearFrom and yearTo params', () => {
    const result = buildFilterQueryString([], [], [], 2020, 2024, LANGUAGE_BY_CODE)
    expect(result).toBe('?yearFrom=2020&yearTo=2024')
  })

  it('builds yearFrom only when yearTo is null', () => {
    const result = buildFilterQueryString([], [], [], 2020, null, LANGUAGE_BY_CODE)
    expect(result).toBe('?yearFrom=2020')
  })

  it('combines all filter types in one query string', () => {
    const result = buildFilterQueryString(['ja'], ['pdf'], ['book'], 2020, 2024, LANGUAGE_BY_CODE)
    expect(result).toBe('?languages[]=japanese&extensions[]=PDF&selected_content_types[]=book&yearFrom=2020&yearTo=2024')
  })

  it('appends e=1 when exact matching is enabled', () => {
    const result = buildFilterQueryString([], [], [], null, null, LANGUAGE_BY_CODE, true)
    expect(result).toBe('?e=1')
  })

  it('appends e=1 with other filters preserving order', () => {
    const result = buildFilterQueryString(['ja'], ['pdf'], ['book'], 2020, 2024, LANGUAGE_BY_CODE, true)
    expect(result).toBe('?languages[]=japanese&extensions[]=PDF&selected_content_types[]=book&yearFrom=2020&yearTo=2024&e=1')
  })

  it('URL-encodes special characters in language names', () => {
    const langMap = new Map([['tl', 'Tagalog/Filipino']])
    const result = buildFilterQueryString(['tl'], [], [], null, null, langMap)
    expect(result).toBe('?languages[]=tagalog%2Ffilipino')
  })
})

describe('search-pipeline toArray', () => {
  it('handles null/undefined', () => {
    expect(toArray(null)).toEqual([])
    expect(toArray(undefined)).toEqual([])
  })

  it('handles arrays', () => {
    expect(toArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('splits comma-separated strings', () => {
    expect(toArray('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace', () => {
    expect(toArray(' a , b ')).toEqual(['a', 'b'])
  })

  it('filters empty strings', () => {
    expect(toArray('a,,b')).toEqual(['a', 'b'])
  })
})

describe('search-pipeline filterByRegex', () => {
  const rows = [
    { title: '算法导论', author: 'Thomas H. Cormen', publisher: 'MIT Press' },
    { title: 'Война и мир', author: 'Лев Толстой', publisher: 'Русский Вестник' },
    { title: 'البرمجة بلغة بايثون', author: 'أحمد علي', publisher: 'دار المعرفة' }
  ]

  it('filters by title regex with unicode support', () => {
    const result = filterByRegex(rows, '算法', '', '')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('算法导论')
  })

  it('filters by author regex with unicode support', () => {
    const result = filterByRegex(rows, '', 'толстой', '')
    expect(result).toHaveLength(1)
    expect(result[0].author).toBe('Лев Толстой')
  })

  it('filters by publisher regex with unicode support', () => {
    const result = filterByRegex(rows, '', '', 'دار')
    expect(result).toHaveLength(1)
    expect(result[0].publisher).toBe('دار المعرفة')
  })

  it('combines regex filters with AND semantics', () => {
    const result = filterByRegex(rows, 'python|بايثون', 'أحمد', 'المعرفة')
    expect(result).toHaveLength(1)
  })

  it('throws ArgumentError for invalid regex', () => {
    expect(() => filterByRegex(rows, '[abc', '', '')).toThrow(/filter-regex-title/)
  })
})

describe('search-pipeline assertKnownValues', () => {
  const isEven = v => Number(v) % 2 === 0

  it('does not throw when all values are known', () => {
    expect(() => assertKnownValues(['2', '4'], isEven, 'num', '2, 4, 6')).not.toThrow()
  })

  it('throws ArgumentError when unknown values present', () => {
    expect(() => assertKnownValues(['2', '3'], isEven, 'num', '2, 4, 6')).toThrow()
  })

  it('does not throw on empty array', () => {
    expect(() => assertKnownValues([], isEven, 'num', '2, 4, 6')).not.toThrow()
  })
})
