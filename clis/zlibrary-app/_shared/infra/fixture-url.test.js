import { describe, it, expect } from 'vitest'
import { normalizeFixtureUrls } from '../fixture/index.js'

describe('normalizeFixtureUrls', () => {
  it('converts absolute https URL to relative path and renames key', () => {
    const input = { url: 'https://z-lib.fm/book/X/title.html' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('/book/X/title.html')
    expect(result.url).toBeUndefined()
  })

  it('preserves query string', () => {
    const input = { url: 'https://x.sk/p?q=1' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('/p?q=1')
  })

  it('preserves hash fragment', () => {
    const input = { url: 'https://x.sk/p#sec' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('/p#sec')
  })

  it('returns empty string for non-http(s) URL', () => {
    const input = { url: 'ftp://x.sk/p' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('')
  })

  it('returns empty string for unparseable URL', () => {
    const input = { url: 'not-a-url' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('')
  })

  it('returns empty string for empty string', () => {
    const input = { url: '' }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('')
  })

  it('returns empty string for non-string value', () => {
    const input = { url: 42 }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.url_path).toBe('')
  })

  it('traverses nested objects', () => {
    const input = { book: { url: 'https://z-lib.fm/book/123/title.html' } }
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result.book.url_path).toBe('/book/123/title.html')
  })

  it('traverses arrays', () => {
    const input = [
      { url: 'https://z-lib.fm/book/1/one.html' },
      { url: 'https://z-lib.fm/book/2/two.html' },
    ]
    const result = normalizeFixtureUrls(input, { url: 'url_path' })
    expect(result[0].url_path).toBe('/book/1/one.html')
    expect(result[1].url_path).toBe('/book/2/two.html')
  })

  it('does not mutate original data', () => {
    const input = { url: 'https://z-lib.fm/book/X/title.html' }
    const original = input.url
    normalizeFixtureUrls(input, ['url'])
    expect(input.url).toBe(original)
  })

  it('handles multiple url fields with mixed rename', () => {
    const input = { url: 'https://a.com/p', downloadUrl: 'https://b.com/d' }
    const result = normalizeFixtureUrls(input, { url: 'url_path', downloadUrl: 'downloadUrl' })
    expect(result.url_path).toBe('/p')
    expect(result.downloadUrl).toBe('/d')
  })

  it('returns null/undefined as-is', () => {
    expect(normalizeFixtureUrls(null, ['url'])).toBeNull()
    expect(normalizeFixtureUrls(undefined, ['url'])).toBeUndefined()
  })

  it('handles empty array', () => {
    const result = normalizeFixtureUrls([], ['url'])
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })

  it('handles empty object', () => {
    const result = normalizeFixtureUrls({}, ['url'])
    expect(result).toEqual({})
  })
})