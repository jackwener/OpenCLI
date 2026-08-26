import { describe, it, expect } from 'vitest'
import {
  MD5_FILENAME_TAG,
  CDN_MD5_TAG_RE,
  PROFILE_MD5_FILENAME_FORMAT_API,
  PROFILE_MD5_FILENAME_FORMAT_DISPLAY,
  hasMd5InFilenameFormat,
  formatMd5Tag,
  extractCdnMd5Tag,
} from './md5-format.js'

describe('MD5_FILENAME_TAG', () => {
  it('contains %m as the replaceable token', () => {
    expect(MD5_FILENAME_TAG).toBe('_MD5_%m_')
  })
})

describe('CDN_MD5_TAG_RE', () => {
  it('matches _MD5_<32hex>_ with trailing _', () => {
    const match = '_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_'.match(CDN_MD5_TAG_RE)
    expect(match).toBeTruthy()
    expect(match[1].toLowerCase()).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
  })

  it('does NOT match without trailing _', () => {
    const match = '_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'.match(CDN_MD5_TAG_RE)
    expect(match).toBeNull()
  })

  it('is case insensitive', () => {
    const match = '_md5_A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6_'.match(CDN_MD5_TAG_RE)
    expect(match).toBeTruthy()
    expect(match[1].toLowerCase()).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
  })

  it('does not match short hex strings', () => {
    expect('_MD5_abc123_'.match(CDN_MD5_TAG_RE)).toBeNull()
  })
})

describe('PROFILE_MD5_FILENAME_FORMAT_API', () => {
  it('uses %t %a %m Z-Library format codes', () => {
    expect(PROFILE_MD5_FILENAME_FORMAT_API).toContain('%t')
    expect(PROFILE_MD5_FILENAME_FORMAT_API).toContain('%a')
    expect(PROFILE_MD5_FILENAME_FORMAT_API).toContain('%m')
  })

  it('embeds MD5_FILENAME_TAG', () => {
    expect(PROFILE_MD5_FILENAME_FORMAT_API).toContain(MD5_FILENAME_TAG)
  })
})

describe('PROFILE_MD5_FILENAME_FORMAT_DISPLAY', () => {
  it('uses {Title} {Author} {md5} display placeholders', () => {
    expect(PROFILE_MD5_FILENAME_FORMAT_DISPLAY).toContain('{Title}')
    expect(PROFILE_MD5_FILENAME_FORMAT_DISPLAY).toContain('{Author}')
    expect(PROFILE_MD5_FILENAME_FORMAT_DISPLAY).toContain('{md5}')
  })

  it('is consistent with API format', () => {
    expect(PROFILE_MD5_FILENAME_FORMAT_DISPLAY).toBe('{Title} ({Author})_MD5_{md5}_')
  })
})

describe('hasMd5InFilenameFormat', () => {
  it('detects desugared format from DOM', () => {
    expect(hasMd5InFilenameFormat('{Title} ({Author})_MD5_{md5}_')).toBe(true)
  })

  it('detects raw tag with %m', () => {
    expect(hasMd5InFilenameFormat('%t (%a)_MD5_%m_')).toBe(true)
  })

  it('returns false for non-MD5 text', () => {
    expect(hasMd5InFilenameFormat('{Title} ({Author})')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasMd5InFilenameFormat('')).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(hasMd5InFilenameFormat(null)).toBe(false)
    expect(hasMd5InFilenameFormat(undefined)).toBe(false)
  })
})

describe('formatMd5Tag', () => {
  it('replaces %m with the md5 hex value', () => {
    expect(formatMd5Tag('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'))
      .toBe('_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_')
  })

  it('lowercases the input', () => {
    expect(formatMd5Tag('A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6'))
      .toBe('_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_')
  })
})

describe('extractCdnMd5Tag', () => {
  it('extracts MD5 from _MD5_<32hex>_', () => {
    expect(extractCdnMd5Tag('_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_'))
      .toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
  })

  it('returns empty string for no trailing _', () => {
    expect(extractCdnMd5Tag('_MD5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'))
      .toBe('')
  })

  it('returns empty string for no match', () => {
    expect(extractCdnMd5Tag('no md5 here')).toBe('')
  })

  it('returns empty string for null/undefined input', () => {
    expect(extractCdnMd5Tag(null)).toBe('')
    expect(extractCdnMd5Tag(undefined)).toBe('')
  })
})
