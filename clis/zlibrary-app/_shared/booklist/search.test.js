/**
 * Unit tests for shared booklist search module.
 *
 * Tests parseBooklistSearchOptions and collectBooksForBooklist directly
 * (shared logic used across create, add, and manage commands).
 */
import { describe, expect, it } from 'vitest'
import { ArgumentError } from '@jackwener/opencli/errors'
import { parseBooklistSearchOptions, hasBooklistSearchArgs, applyBooklistSearchFilters } from '../infra/booklist-search.js'

describe('parseBooklistSearchOptions', () => {
  it('returns empty arrays and default limit when no filters given', () => {
    const result = parseBooklistSearchOptions({}, 'test')
    expect(result).toMatchObject({
      langCodes: [],
      langNames: [],
      extensions: [],
      exactMatching: false,
      regexTitle: '',
      regexAuthor: '',
      regexPublisher: '',
      unlimited: false
    })
    expect(typeof result.limit).toBe('number')
  })

  it('rejects invalid --filter-lang-codes', () => {
    expect(() => {
      parseBooklistSearchOptions({ 'filter-lang-codes': 'xx' }, 'test')
    }).toThrow(ArgumentError)
  })

  it('rejects invalid --filter-lang-names', () => {
    expect(() => {
      parseBooklistSearchOptions({ 'filter-lang-names': 'Klingon' }, 'test')
    }).toThrow(ArgumentError)
  })

  it('rejects invalid --filter-ext', () => {
    expect(() => {
      parseBooklistSearchOptions({ 'filter-ext': 'exe' }, 'test')
    }).toThrow(ArgumentError)
  })

  it('rejects --limit and --unlimited together', () => {
    expect(() => {
      parseBooklistSearchOptions({ limit: 10, unlimited: true }, 'test')
    }).toThrow(ArgumentError)
  })

  it('accepts valid --filter-lang-codes', () => {
    const result = parseBooklistSearchOptions({ 'filter-lang-codes': 'en,ja' }, 'test')
    expect(result.langCodes).toEqual(['en', 'ja'])
  })

  it('accepts valid --filter-lang-names', () => {
    const result = parseBooklistSearchOptions({ 'filter-lang-names': 'English,Japanese' }, 'test')
    expect(result.langNames).toEqual(['English', 'Japanese'])
  })

  it('accepts valid --filter-ext', () => {
    const result = parseBooklistSearchOptions({ 'filter-ext': 'pdf,epub' }, 'test')
    expect(result.extensions).toEqual(['pdf', 'epub'])
  })

  it('sets limit to null when --unlimited is true', () => {
    const result = parseBooklistSearchOptions({ unlimited: true }, 'test')
    expect(result.limit).toBeNull()
    expect(result.unlimited).toBe(true)
  })

  it('parses exact matching and regex filters', () => {
    const result = parseBooklistSearchOptions({
      'filter-exact-matching': true,
      'filter-regex-title': '算法',
      'filter-regex-author': 'Tolstoy',
      'filter-regex-publisher': 'Press'
    }, 'test')
    expect(result.exactMatching).toBe(true)
    expect(result.regexTitle).toBe('算法')
    expect(result.regexAuthor).toBe('Tolstoy')
    expect(result.regexPublisher).toBe('Press')
  })

  it('rejects regex flag without a value', () => {
    expect(() => {
      parseBooklistSearchOptions({ 'filter-regex-title': true }, 'test')
    }).toThrow(ArgumentError)
  })

  it('rejects --limit below 1', () => {
    expect(() => {
      parseBooklistSearchOptions({ limit: 0 }, 'test')
    }).toThrow(ArgumentError)
  })

  it('rejects --limit above 50', () => {
    expect(() => {
      parseBooklistSearchOptions({ limit: 999 }, 'test')
    }).toThrow(ArgumentError)
  })

  it('includes command name in error messages', () => {
    try {
      parseBooklistSearchOptions({ 'filter-ext': 'exe' }, 'mycommand')
    } catch (e) {
      expect(e.message).toContain('booklist-mycommand')
    }
  })

  describe('--filter-year-from / --filter-year-to validation', () => {
    it('accepts valid --filter-year-from', () => {
      const result = parseBooklistSearchOptions({ 'filter-year-from': '2020' }, 'test')
      expect(result.filterYearFrom).toBe(2020)
    })

    it('accepts valid --filter-year-to', () => {
      const result = parseBooklistSearchOptions({ 'filter-year-to': '2024' }, 'test')
      expect(result.filterYearTo).toBe(2024)
    })

    it('accepts both --filter-year-from and --filter-year-to', () => {
      const result = parseBooklistSearchOptions({ 'filter-year-from': '2018', 'filter-year-to': '2023' }, 'test')
      expect(result.filterYearFrom).toBe(2018)
      expect(result.filterYearTo).toBe(2023)
    })

    it('rejects negative --filter-year-from', () => {
      expect(() => {
        parseBooklistSearchOptions({ 'filter-year-from': '-1' }, 'test')
      }).toThrow(ArgumentError)
    })

    it('rejects non-integer --filter-year-from', () => {
      expect(() => {
        parseBooklistSearchOptions({ 'filter-year-from': 'abc' }, 'test')
      }).toThrow(ArgumentError)
    })

    it('rejects --filter-year-from > --filter-year-to', () => {
      expect(() => {
        parseBooklistSearchOptions({ 'filter-year-from': '2024', 'filter-year-to': '2020' }, 'test')
      }).toThrow(ArgumentError)
    })

    it('accepts --filter-year-from without --filter-year-to', () => {
      const result = parseBooklistSearchOptions({ 'filter-year-from': '2020' }, 'test')
      expect(result.filterYearTo).toBeNull()
    })

    it('accepts --filter-year-to without --filter-year-from', () => {
      const result = parseBooklistSearchOptions({ 'filter-year-to': '2024' }, 'test')
      expect(result.filterYearFrom).toBeNull()
    })
  })
})

describe('hasBooklistSearchArgs', () => {
  it('returns false with no filter args', () => {
    expect(hasBooklistSearchArgs({})).toBe(false)
  })

  it('returns false when only --limit is set', () => {
    expect(hasBooklistSearchArgs({ limit: 10 })).toBe(false)
  })

  it('returns true when --filter-lang-codes is set', () => {
    expect(hasBooklistSearchArgs({ 'filter-lang-codes': 'en,ja' })).toBe(true)
  })

  it('returns true when --filter-ext is set', () => {
    expect(hasBooklistSearchArgs({ 'filter-ext': 'pdf' })).toBe(true)
  })

  it('returns true when --filter-year-from is set', () => {
    expect(hasBooklistSearchArgs({ 'filter-year-from': 2020 })).toBe(true)
  })

  it('returns true when --filter-year-to is set', () => {
    expect(hasBooklistSearchArgs({ 'filter-year-to': 2024 })).toBe(true)
  })

  it('returns true when --unlimited is true', () => {
    expect(hasBooklistSearchArgs({ unlimited: true })).toBe(true)
  })

  it('returns true when --filter-exact-matching is true', () => {
    expect(hasBooklistSearchArgs({ 'filter-exact-matching': true })).toBe(true)
  })

  it('returns true when regex filters are set', () => {
    expect(hasBooklistSearchArgs({ 'filter-regex-title': '算法' })).toBe(true)
    expect(hasBooklistSearchArgs({ 'filter-regex-author': 'Tolstoy' })).toBe(true)
    expect(hasBooklistSearchArgs({ 'filter-regex-publisher': 'Press' })).toBe(true)
  })

  it('returns false when --unlimited is false', () => {
    expect(hasBooklistSearchArgs({ unlimited: false })).toBe(false)
  })

  it('returns false when --filter-year-from is null', () => {
    expect(hasBooklistSearchArgs({ 'filter-year-from': null })).toBe(false)
  })
})

describe('applyBooklistSearchFilters', () => {
  const books = [
    { id: '1', title: 'Book A', language: 'English', extension: 'pdf', year: 2020 },
    { id: '2', title: 'Book B', language: 'Japanese', extension: 'epub', year: 2021 },
    { id: '3', title: 'Book C', language: 'English', extension: 'mobi', year: 2022 },
    { id: '4', title: 'Book D', language: 'French', extension: 'pdf', year: 2023 }
  ]

  it('returns all books when no filters active', () => {
    const options = { langCodes: [], langNames: [], extensions: [], filterYearFrom: null, filterYearTo: null, regexTitle: '', regexAuthor: '', regexPublisher: '' }
    expect(applyBooklistSearchFilters(books, options)).toEqual(books)
  })

  it('passes through all books when only language code filter is active (URL-only)', () => {
    // --filter-lang-codes is applied via URL params, not JS post-filter
    const options = { langCodes: ['en'], langNames: [], extensions: [], filterYearFrom: null, filterYearTo: null, regexTitle: '', regexAuthor: '', regexPublisher: '' }
    const result = applyBooklistSearchFilters(books, options)
    expect(result).toHaveLength(4)
    expect(result).toEqual(books)
  })

  it('passes through all books when only year range filter is active (URL-only)', () => {
    const options = { langCodes: [], langNames: [], extensions: [], filterYearFrom: 2022, filterYearTo: null, regexTitle: '', regexAuthor: '', regexPublisher: '' }
    const result = applyBooklistSearchFilters(books, options)
    expect(result).toHaveLength(4)
    expect(result).toEqual(books)
  })

  it('passes through all books when combined non-regex filters active (URL-only)', () => {
    const options = { langCodes: ['en'], langNames: [], extensions: ['pdf'], filterYearFrom: 2022, filterYearTo: null, regexTitle: '', regexAuthor: '', regexPublisher: '' }
    const result = applyBooklistSearchFilters(books, options)
    expect(result).toHaveLength(4)
    expect(result).toEqual(books)
  })

  it('passes through all books when year range has no valid match (URL-only)', () => {
    const options = { langCodes: [], langNames: [], extensions: [], filterYearFrom: 2030, filterYearTo: null, regexTitle: '', regexAuthor: '', regexPublisher: '' }
    const result = applyBooklistSearchFilters(books, options)
    expect(result).toHaveLength(4)
    expect(result).toEqual(books)
  })

  it('filters by title regex', () => {
    const options = { langCodes: [], langNames: [], extensions: [], filterYearFrom: null, filterYearTo: null, regexTitle: 'Book [AB]', regexAuthor: '', regexPublisher: '' }
    const result = applyBooklistSearchFilters(books, options)
    expect(result).toHaveLength(2)
  })
})
