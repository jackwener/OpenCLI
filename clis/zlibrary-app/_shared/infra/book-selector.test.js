import { describe, expect, it, vi } from 'vitest'
import { resolveBookSelector, validateBookSelectorOrigin, navigateAndExtractBookId, navigateToBookSelector, extractCurrentBookId } from './book-selector.js'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { createPageMock } from '../../../test-utils.js'

describe('resolveBookSelector', () => {
  // -- Happy path: ID ------------------------------------------------
  it('returns { kind: "id", bookId } for numeric input', () => {
    expect(resolveBookSelector('5433175')).toEqual({ kind: 'id', bookId: '5433175' })
  })

  it('returns { kind: "id" } for zero-padded numeric input', () => {
    expect(resolveBookSelector('00123')).toEqual({ kind: 'id', bookId: '00123' })
  })

  it('returns { kind: "id" } for numeric 0 (falsy value)', () => {
    expect(resolveBookSelector('0')).toEqual({ kind: 'id', bookId: '0' })
  })

  // -- Happy path: absolute URL --------------------------------------
  it('returns { kind: "url" } for absolute http URL', () => {
    const result = resolveBookSelector('http://z-lib.org/book/12345')
    expect(result.kind).toBe('url')
    expect(result.urlRelative).toBe('/book/12345')
    expect(result.originalOrigin).toBe('http://z-lib.org')
  })

  it('returns { kind: "url" } for absolute https URL', () => {
    const result = resolveBookSelector('https://z-lib.org/book/12345')
    expect(result.kind).toBe('url')
    expect(result.urlRelative).toBe('/book/12345')
    expect(result.originalOrigin).toBe('https://z-lib.org')
  })

  it('strips query string and hash from absolute URL', () => {
    const result = resolveBookSelector('https://z-lib.org/book/12345?q=1#top')
    expect(result.urlRelative).toBe('/book/12345?q=1#top')
    expect(result.originalOrigin).toBe('https://z-lib.org')
  })

  it('accepts absolute URL with non-numeric path segment', () => {
    const result = resolveBookSelector('https://frenchbooks.sk/book/demo')
    expect(result.urlRelative).toBe('/book/demo')
    expect(result.originalOrigin).toBe('https://frenchbooks.sk')
  })

  it('accepts absolute URL with trailing slash', () => {
    const result = resolveBookSelector('https://z-lib.org/book/12345/')
    expect(result.urlRelative).toBe('/book/12345/')
    expect(result.originalOrigin).toBe('https://z-lib.org')
  })

  // -- Happy path: relative URL --------------------------------------
  it('returns { kind: "url" } for relative /book/ URL', () => {
    const result = resolveBookSelector('/book/demo')
    expect(result.kind).toBe('url')
    expect(result.urlRelative).toBe('/book/demo')
    expect(result.originalOrigin).toBe('')
  })

  it('accepts relative URL with numeric path', () => {
    const result = resolveBookSelector('/book/12345')
    expect(result.urlRelative).toBe('/book/12345')
    expect(result.originalOrigin).toBe('')
  })

  it('accepts relative URL with query string', () => {
    const result = resolveBookSelector('/book/12345?page=2')
    expect(result).toMatchObject({
      kind: 'url',
      urlRelative: '/book/12345?page=2',
      originalOrigin: '',
    })
  })

  // -- Error cases: empty/blank --------------------------------------
  it('throws ArgumentError for empty string', () => {
    expect(() => resolveBookSelector('')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for whitespace-only', () => {
    expect(() => resolveBookSelector('   ')).toThrow(ArgumentError)
  })

  // -- Error cases: invalid format -----------------------------------
  it('throws ArgumentError for non-numeric, non-URL input', () => {
    expect(() => resolveBookSelector('abc')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for alphanumeric input', () => {
    expect(() => resolveBookSelector('12a34')).toThrow(ArgumentError)
  })

  // -- Security: unsafe schemes --------------------------------------
  it('throws ArgumentError for javascript: URL', () => {
    expect(() => resolveBookSelector('javascript:alert(1)')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for file: URL', () => {
    expect(() => resolveBookSelector('file:///etc/passwd')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for data: URL', () => {
    expect(() => resolveBookSelector('data:text/plain,hello')).toThrow(ArgumentError)
  })

  // -- Security: invalid paths ---------------------------------------
  it('throws ArgumentError for non-/book/ relative path', () => {
    expect(() => resolveBookSelector('/search?q=test')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for root path', () => {
    expect(() => resolveBookSelector('/')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for absolute URL with non-book path', () => {
    expect(() => resolveBookSelector('https://z-lib.org/search')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for absolute URL with /home path', () => {
    expect(() => resolveBookSelector('https://z-lib.org/home')).toThrow(ArgumentError)
  })

  // -- Security: path traversal ---------------------------------------
  it('rejects relative URL with path traversal /book/../search', () => {
    expect(() => resolveBookSelector('/book/../search')).toThrow(ArgumentError)
  })

  it('rejects relative URL with encoded path traversal /book/%2e%2e/search', () => {
    expect(() => resolveBookSelector('/book/%2e%2e/search')).toThrow(ArgumentError)
  })

  it('rejects relative URL with uppercase encoded path traversal /book/%2E%2E/search', () => {
    expect(() => resolveBookSelector('/book/%2E%2E/search')).toThrow(ArgumentError)
  })

  it('preserves query and hash after normalization for relative URL', () => {
    const result = resolveBookSelector('/book/demo?page=2#section')
    expect(result.urlRelative).toBe('/book/demo?page=2#section')
  })

  // -- Error messages ------------------------------------------------
  it('uses custom optionName in error messages', () => {
    try {
      resolveBookSelector('', '--add-book-id')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toContain('--add-book-id')
    }
  })

  it('error message mentions both ID and URL', () => {
    try {
      resolveBookSelector('abc')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toMatch(/numeric book ID|Z-Library book URL/)
    }
  })
})

describe('validateBookSelectorOrigin', () => {
  it('passes for numeric ID (no origin to validate)', () => {
    const selector = { kind: 'id', bookId: '12345' }
    expect(() => validateBookSelectorOrigin(selector, 'https://z-lib.org')).not.toThrow()
  })

  it('passes for relative URL (no originalOrigin)', () => {
    const selector = { kind: 'url', urlRelative: '/book/demo', originalOrigin: '' }
    expect(() => validateBookSelectorOrigin(selector, 'https://z-lib.org')).not.toThrow()
  })

  it('passes for same-origin absolute URL', () => {
    const selector = { kind: 'url', urlRelative: '/book/12345', originalOrigin: 'https://z-lib.org' }
    expect(() => validateBookSelectorOrigin(selector, 'https://z-lib.org')).not.toThrow()
  })

  it('passes for same-origin absolute URL with different path', () => {
    const selector = { kind: 'url', urlRelative: '/book/demo', originalOrigin: 'https://frenchbooks.sk' }
    expect(() => validateBookSelectorOrigin(selector, 'https://frenchbooks.sk')).not.toThrow()
  })

  it('throws ArgumentError for cross-origin absolute URL', () => {
    const selector = { kind: 'url', urlRelative: '/book/12345', originalOrigin: 'https://evil.com' }
    expect(() => validateBookSelectorOrigin(selector, 'https://z-lib.org')).toThrow(ArgumentError)
  })

  it('throws ArgumentError for cross-origin URL (different mirror)', () => {
    const selector = { kind: 'url', urlRelative: '/book/12345', originalOrigin: 'https://z-lib.org' }
    expect(() => validateBookSelectorOrigin(selector, 'https://frenchbooks.sk')).toThrow(ArgumentError)
  })

  it('error message includes both origins', () => {
    const selector = { kind: 'url', urlRelative: '/book/12345', originalOrigin: 'https://evil.com' }
    try {
      validateBookSelectorOrigin(selector, 'https://z-lib.org')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toContain('same-site')
      expect(e.hint || e.message).toMatch(/evil\.com|z-lib\.org/)
    }
  })

  it('uses custom optionName in error messages', () => {
    const selector = { kind: 'url', urlRelative: '/book/12345', originalOrigin: 'https://evil.com' }
    try {
      validateBookSelectorOrigin(selector, 'https://z-lib.org', '--add-book-id')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toContain('--add-book-id')
    }
  })
})

describe('navigateAndExtractBookId', () => {
  it('navigates via URL and extracts book ID from z-bookcard', async () => {
    const page = createPageMock(['https://z-lib.org', 'https://z-lib.org', '5433175'])
    const result = await navigateAndExtractBookId(page, {
      kind: 'url',
      urlRelative: '/book/demo',
      originalOrigin: 'https://z-lib.org',
    })
    expect(result).toBe('5433175')
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/demo', expect.any(Object))
    expect(page.wait).toHaveBeenCalledWith(1.5)
  })

  it('navigates via ID and extracts book ID (no origin check needed)', async () => {
    const page = createPageMock(['https://z-lib.org', '12345'])
    const result = await navigateAndExtractBookId(page, {
      kind: 'id',
      bookId: '12345',
    })
    expect(result).toBe('12345')
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/12345', expect.any(Object))
  })

  it('navigates via relative URL (no origin check needed)', async () => {
    const page = createPageMock(['https://z-lib.gl', '5433175'])
    const result = await navigateAndExtractBookId(page, {
      kind: 'url',
      urlRelative: '/book/demo',
      originalOrigin: '',
    })
    expect(result).toBe('5433175')
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.gl/book/demo', expect.any(Object))
  })

  it('throws ArgumentError for cross-origin absolute URL', async () => {
    const page = createPageMock(['https://frenchbooks.sk'])
    await expect(
      navigateAndExtractBookId(page, {
        kind: 'url',
        urlRelative: '/book/12345',
        originalOrigin: 'https://evil.com',
      }),
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('allows same-origin absolute URL', async () => {
    const page = createPageMock(['https://frenchbooks.sk', 'https://frenchbooks.sk', '99999'])
    const result = await navigateAndExtractBookId(page, {
      kind: 'url',
      urlRelative: '/book/demo',
      originalOrigin: 'https://frenchbooks.sk',
    })
    expect(result).toBe('99999')
  })

  it('throws CommandExecutionError when no card found on page', async () => {
    const page = createPageMock(['https://z-lib.org', 'https://z-lib.org', ''])
    await expect(
      navigateAndExtractBookId(page, { kind: 'url', urlRelative: '/book/demo', originalOrigin: 'https://z-lib.org' }),
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('throws CommandExecutionError when evaluate returns null', async () => {
    const page = createPageMock(['https://z-lib.org', 'https://z-lib.org', null])
    await expect(
      navigateAndExtractBookId(page, { kind: 'url', urlRelative: '/book/demo', originalOrigin: 'https://z-lib.org' }),
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })
})

describe('navigateToBookSelector', () => {
  it('navigates via URL', async () => {
    const page = createPageMock(['https://z-lib.org', 'https://z-lib.org'])
    await navigateToBookSelector(page, {
      kind: 'url',
      urlRelative: '/book/demo',
      originalOrigin: 'https://z-lib.org',
    })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/demo', expect.any(Object))
    expect(page.wait).toHaveBeenCalledWith(1.5)
  })

  it('navigates via ID', async () => {
    const page = createPageMock(['https://z-lib.org'])
    await navigateToBookSelector(page, {
      kind: 'id',
      bookId: '12345',
    })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/12345', expect.any(Object))
  })

  it('navigates relative URL without origin check', async () => {
    const page = createPageMock(['https://z-lib.gl'])
    await navigateToBookSelector(page, {
      kind: 'url',
      urlRelative: '/book/demo',
      originalOrigin: '',
    })
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.gl/book/demo', expect.any(Object))
  })

  it('throws ArgumentError for cross-origin absolute URL', async () => {
    const page = createPageMock(['https://frenchbooks.sk'])
    await expect(
      navigateToBookSelector(page, {
        kind: 'url',
        urlRelative: '/book/12345',
        originalOrigin: 'https://evil.com',
      }),
    ).rejects.toBeInstanceOf(ArgumentError)
  })
})

describe('extractCurrentBookId', () => {
  it('extracts book ID from z-bookcard element', async () => {
    const page = createPageMock(['5433175'])
    const result = await extractCurrentBookId(page)
    expect(result).toBe('5433175')
  })

  it('throws CommandExecutionError when no card found', async () => {
    const page = createPageMock([''])
    await expect(extractCurrentBookId(page)).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('throws CommandExecutionError when evaluate returns null', async () => {
    const page = createPageMock([null])
    await expect(extractCurrentBookId(page)).rejects.toBeInstanceOf(CommandExecutionError)
  })
})