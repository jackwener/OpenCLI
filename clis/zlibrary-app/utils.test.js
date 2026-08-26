import { beforeEach, describe, expect, it } from 'vitest'

describe('zlibrary-app utils - extractMd5FromCdnFilenameParam', () => {
  let extractMd5FromCdnFilenameParam

  beforeEach(async () => {
    const utils = await import('./utils.js')
    extractMd5FromCdnFilenameParam = utils.extractMd5FromCdnFilenameParam
  })

  it('extracts MD5 from filename param with _MD5_<32hex>_ pattern', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?filename=Title_MD5_aab59e4fc181cbc32fb844353dc0fbd8_.epub'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('aab59e4fc181cbc32fb844353dc0fbd8')
  })

  it('extracts MD5 from URL-encoded filename param', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?filename=Some%20Book_MD5_abcdef1234567890abcdef1234567890_.pdf'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('abcdef1234567890abcdef1234567890')
  })

  it('lowercases uppercase MD5 from filename param', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?filename=_MD5_ABCDEF1234567890ABCDEF1234567890_'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('abcdef1234567890abcdef1234567890')
  })

  it('returns empty string when no filename param present', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('')
  })

  it('returns empty string for invalid/unparseable URL', () => {
    const url = 'not-a-valid-url'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('')
  })

  it('returns empty string when filename param has no MD5 tag', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?filename=SomeBook.epub'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('')
  })

  it('returns empty string for empty/null input', () => {
    expect(extractMd5FromCdnFilenameParam('')).toBe('')
    expect(extractMd5FromCdnFilenameParam(null)).toBe('')
    expect(extractMd5FromCdnFilenameParam(undefined)).toBe('')
  })

  it('extracts MD5 when filename has multiple query params', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?token=xyz&filename=Book_MD5_1234567890abcdef1234567890abcdef_.epub&expires=12345'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('1234567890abcdef1234567890abcdef')
  })

  it('extracts MD5 from filename with special characters', () => {
    const url = 'https://dln1.ncdn.ec/dl/abc123?filename=The%20Great%20Gatsby%20(F.%20Scott%20Fitzgerald)_MD5_fedcba0987654321fedcba0987654321_.epub'
    const result = extractMd5FromCdnFilenameParam(url)
    expect(result).toBe('fedcba0987654321fedcba0987654321')
  })
})
