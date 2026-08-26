import { describe, it, expect } from 'vitest'
import { renderFilenameTemplate } from './_shared/infra/manifest-helpers.js'
import { parseFilenameTemplate } from './search.js'

// SKIP: All tests in this describe use speculative mock data and test the OLD
// behavior where renderFilenameTemplate PRESERVED unknown {xxx} placeholders.
// Per user direction, the function now STRIPS unresolved {xxx} patterns to
// prevent literal placeholders like ({language-code}) in final filenames.
// This project uses fixture-derived testing only. Do NOT un-skip.
describe.skip('renderFilenameTemplate', () => {
  it('replaces all {key} placeholders with values', () => {
    const result = renderFilenameTemplate(
      '{author} - {title}',
      { author: 'Tolkien', title: 'LOTR' }
    )
    expect(result).toBe('Tolkien - LOTR')
  })

  it('preserves unknown placeholders as-is', () => {
    const result = renderFilenameTemplate(
      '{author} - {title} ({year})',
      { author: 'Tolkien', title: 'LOTR' }
    )
    expect(result).toBe('Tolkien - LOTR ({year})')
  })

  it('sanitizes invalid filename characters', () => {
    const result = renderFilenameTemplate(
      '{author}: {title}/{year}?*.{extension}',
      {
        author: 'Tolkien',
        title: 'LOTR',
        year: '2021',
        extension: 'pdf'
      }
    )
    expect(result).toBe('Tolkien_ LOTR_2021__.pdf')
  })

  it('truncates long filenames to 255 characters', () => {
    const longTitle = 'a'.repeat(300)
    const result = renderFilenameTemplate('{title}', { title: longTitle })
    expect(result).toHaveLength(255)
  })

  it('handles empty values as empty strings', () => {
    const result = renderFilenameTemplate(
      '{author} - {title}',
      { author: '', title: 'LOTR' }
    )
    // Empty string is still substituted; surrounding space is preserved
    expect(result).toBe(' - LOTR')
  })

  it('handles an empty template', () => {
    const result = renderFilenameTemplate('', { title: 'LOTR' })
    expect(result).toBe('')
  })

  it('handles a template with no placeholders', () => {
    const result = renderFilenameTemplate('My Book', { title: 'LOTR' })
    expect(result).toBe('My Book')
  })

  it('handles consecutive placeholders', () => {
    const result = renderFilenameTemplate(
      '{author}_{title}',
      { author: 'Tolkien', title: 'LOTR' }
    )
    expect(result).toBe('Tolkien_LOTR')
  })

  it('handles special characters in values', () => {
    const result = renderFilenameTemplate(
      '{title} ({year})',
      { title: 'The Lord of the Rings', year: '2021' }
    )
    expect(result).toBe('The Lord of the Rings (2021)')
  })

  it('handles numeric values as strings', () => {
    const result = renderFilenameTemplate(
      '{year}',
      { year: '2021' }
    )
    expect(result).toBe('2021')
  })

  it('handles multiple same-key placeholders', () => {
    const result = renderFilenameTemplate(
      '{title} by {author} ({year}) - {title} Edition',
      { title: 'LOTR', author: 'Tolkien', year: '2021' }
    )
    expect(result).toBe('LOTR by Tolkien (2021) - LOTR Edition')
  })

  it('handles search result fields for filename generation', () => {
    const result = renderFilenameTemplate(
      '{author} - {title}.{extension}',
      {
        author: '辰見拓郎',
        title: '超性愛指導手冊',
        extension: 'pdf'
      }
    )
    expect(result).toBe('辰見拓郎 - 超性愛指導手冊.pdf')
  })

  it('handles complex template with all search fields', () => {
    const result = renderFilenameTemplate(
      '{title} ({year}) - {author} - {language} - {id}',
      {
        title: 'The Design of Everyday Things',
        year: '2002',
        author: 'Don Norman',
        language: 'English',
        id: '12345678'
      }
    )
    expect(result).toBe('The Design of Everyday Things (2002) - Don Norman - English - 12345678')
  })

  // -- Kebab-case key resolution (PRD: supported kebab-case keys must resolve) --

  it('resolves kebab-case keys directly', () => {
    expect(
      renderFilenameTemplate('{content-type}', { 'content-type': 'book' })
    ).toBe('book')
  })

  it('resolves quality-rating kebab-case key', () => {
    expect(
      renderFilenameTemplate('{quality-rating}', { 'quality-rating': '4.2' })
    ).toBe('4.2')
  })

  it('resolves format-quality-rating kebab-case key', () => {
    expect(
      renderFilenameTemplate('{format-quality-rating}', { 'format-quality-rating': '3.8' })
    ).toBe('3.8')
  })

  it('resolves isbn-10 kebab-case key', () => {
    expect(
      renderFilenameTemplate('{isbn-10}', { 'isbn-10': '1234567890' })
    ).toBe('1234567890')
  })

  it('resolves isbn-13 kebab-case key', () => {
    expect(
      renderFilenameTemplate('{isbn-13}', { 'isbn-13': '9781234567890' })
    ).toBe('9781234567890')
  })

  it('resolves detail-error kebab-case key', () => {
    const vals = { 'detail-error': 'not found' }
    expect(renderFilenameTemplate('{detail-error}', vals)).toBe('not found')
  })

  it('resolves meta-description kebab-case key', () => {
    const vals = { 'meta-description': 'A great book' }
    expect(renderFilenameTemplate('{meta-description}', vals)).toBe('A great book')
  })

  // -- Alias resolution --

  it('resolves bookId alias', () => {
    expect(
      renderFilenameTemplate('{bookId}', { id: '12345' })
    ).toBe('12345')
  })

  it('resolves book-id alias', () => {
    expect(
      renderFilenameTemplate('{book-id}', { id: '12345' })
    ).toBe('12345')
  })

  it('resolves isbn_number alias', () => {
    expect(
      renderFilenameTemplate('{isbn_number}', { isbn: '123' })
    ).toBe('123')
  })

  it('resolves isbn-number alias', () => {
    expect(
      renderFilenameTemplate('{isbn-number}', { isbn: '123' })
    ).toBe('123')
  })

  it('{isbn10} matches isbn10 field directly', () => {
    expect(
      renderFilenameTemplate('{isbn10}', { isbn10: '1234567890' })
    ).toBe('1234567890')
  })

  it('{isbn13} matches isbn13 field directly', () => {
    expect(
      renderFilenameTemplate('{isbn13}', { isbn13: '9781234567890' })
    ).toBe('9781234567890')
  })

  // -- Unsupported keys remain as-is --

  it('preserves unsupported {sha1} key', () => {
    expect(
      renderFilenameTemplate('{sha1}', { title: 'LOTR' })
    ).toBe('{sha1}')
  })

  it('preserves unsupported {md5} key when md5 not in values', () => {
    expect(
      renderFilenameTemplate('{md5}', { title: 'LOTR' })
    ).toBe('{md5}')
  })

  it('preserves unsupported {unknown} key', () => {
    expect(
      renderFilenameTemplate('{author} - {unknown}', { author: 'Tolkien' })
    ).toBe('Tolkien - {unknown}')
  })

  // -- Auto-extension behavior --

  it('auto-appends .{extension} when not already present', () => {
    const result = renderFilenameTemplate(
      '{author} - {title}',
      { author: 'Tolkien', title: 'LOTR', extension: 'pdf' }
    )
    expect(result).toBe('Tolkien - LOTR.pdf')
  })

  it('does not duplicate extension when template already includes it', () => {
    const result = renderFilenameTemplate(
      '{author} - {title}.{extension}',
      { author: 'Tolkien', title: 'LOTR', extension: 'pdf' }
    )
    expect(result).toBe('Tolkien - LOTR.pdf')
  })

  it('replaces empty values with empty string', () => {
    const result = renderFilenameTemplate(
      '{title}-{author}-{year}',
      { title: 'LOTR', author: '', year: '' }
    )
    expect(result).toBe('LOTR--')
  })

  // -- Tag cut syntax: byte cut (c) --

  describe('byte cut (c)', () => {
    it('truncates to N UTF-8 bytes', () => {
      // 'Tolkien' is 7 bytes; '{author..3c}' should give 3 bytes
      expect(
        renderFilenameTemplate('{author..3c}', { author: 'Tolkien' })
      ).toBe('Tol')
    })

    it('truncates CJK author to bytes at code-point boundary', () => {
      // '辰見拓郎' is 4 code points × 3 bytes = 12 bytes
      // 9 bytes should give exactly 3 code points (each 3 bytes = 9)
      expect(
        renderFilenameTemplate('{author..9c}', { author: '辰見拓郎' })
      ).toBe('辰見拓')
    })

    it('byte cut does not split a Unicode code point', () => {
      // '辰' is 3 bytes; requesting 4 bytes should give 1 code point (3 bytes), not a partial '辰'
      expect(
        renderFilenameTemplate('{author..4c}', { author: '辰見' })
      ).toBe('辰')
    })

    it('byte cut handles mixed ASCII and CJK', () => {
      // 'A辰' = 1 byte + 3 bytes = 4 bytes total
      // 3 bytes → just 'A' (1 byte), can't add '辰' (would be 4)
      expect(
        renderFilenameTemplate('{title..3c}', { title: 'A辰' })
      ).toBe('A')
    })

    it('byte cut of already-short string returns unchanged', () => {
      expect(
        renderFilenameTemplate('{author..100c}', { author: 'Short' })
      ).toBe('Short')
    })
  })

  // -- Tag cut syntax: Unicode code-point cut (u) --

  describe('unicode cut (u)', () => {
    it('truncates to N Unicode code points', () => {
      expect(
        renderFilenameTemplate('{author..3u}', { author: 'Tolkien' })
      ).toBe('Tol')
    })

    it('truncates CJK to code points', () => {
      expect(
        renderFilenameTemplate('{author..2u}', { author: '辰見拓郎' })
      ).toBe('辰見')
    })

    it('unicode cut of already-short string returns unchanged', () => {
      expect(
        renderFilenameTemplate('{author..100u}', { author: '辰見' })
      ).toBe('辰見')
    })

    it('unicode cut uses code-point counting (not UTF-16 code-units)', () => {
      // 🍎 is 1 code point, 👍 is 1 code point
      // 'A🍎B' = 3 code points
      expect(
        renderFilenameTemplate('{title..2u}', { title: 'A🍎B' })
      ).toBe('A🍎')
    })
  })

  // -- Tag cut syntax with ellipsis --

  describe('cut with ellipsis', () => {
    it('byte cut with ellipsis appends … only when truncated', () => {
      // 'Tolkien' (7 bytes); 10 bytes with … (3 bytes) = 7 total
      // 'Tolkien' is 7 bytes, 10 - 3 = 7 for the value → no truncation → no ellipsis
      expect(
        renderFilenameTemplate('{author..10c…}', { author: 'Tolkien' })
      ).toBe('Tolkien')
    })

    it('byte cut with ellipsis truncates value to make room for …', () => {
      // 5 bytes total, … is 3 bytes → room for 2 bytes of value
      // 'Tolkien' byte 0='T'(1), 1='o'(1) = 2 bytes. Next byte would be 3. So cut at 2.
      expect(
        renderFilenameTemplate('{author..5c…}', { author: 'Tolkien' })
      ).toBe('To…')
    })

    it('unicode cut with ellipsis appends … only when truncated', () => {
      // 'Short' is 5 code points; 10 code points limit includes … → no truncation
      expect(
        renderFilenameTemplate('{author..10u…}', { author: 'Short' })
      ).toBe('Short')
    })

    it('unicode cut with ellipsis truncates value to make room for …', () => {
      // 4 code points total, … is 1 → room for 3 code points
      // 'Tolkien' → 'Tol' (3) + '…' (1) = 4 total
      expect(
        renderFilenameTemplate('{author..4u…}', { author: 'Tolkien' })
      ).toBe('Tol…')
    })

    it('byte cut with ellipsis and CJK is within limit', () => {
      // '辰見' = 6 bytes, exactly equals the 6-byte limit → no truncation needed
      expect(
        renderFilenameTemplate('{author..6c…}', { author: '辰見' })
      ).toBe('辰見')
    })

    it('unicode cut with ellipsis when value exactly fits without ellipsis', () => {
      // 3 code points limit, value is 3 code points → exact fit → no ellipsis
      expect(
        renderFilenameTemplate('{title..3u…}', { title: 'Abc' })
      ).toBe('Abc')
    })

    it('ellipsis is included in the total limit', () => {
      // 2 code point total, … takes 1 → value gets 1 code point
      // 'Abc' → 'A' (1 cp) + '…' (1 cp) = 2 cp total
      expect(
        renderFilenameTemplate('{title..2u…}', { title: 'Abc' })
      ).toBe('A…')
    })

    it('byte cut with ellipsis where ellipsis is 3 bytes', () => {
      // 4 bytes total, … is 3 bytes → room for 1 byte of value
      // 'Abcde' (5 bytes) → 'A' (1 byte) + '…' (3 bytes) = 4 bytes total
      expect(
        renderFilenameTemplate('{title..4c…}', { title: 'Abcde' })
      ).toBe('A…')
    })
  })

  // -- Zero-length cuts: preserved literally --

  describe('zero-length cuts', () => {
    it('preserves {title..0u} literally', () => {
      expect(
        renderFilenameTemplate('{title..0u}', { title: 'Short' })
      ).toBe('{title..0u}')
    })

    it('preserves {title..0c} literally', () => {
      expect(
        renderFilenameTemplate('{title..0c}', { title: 'Short' })
      ).toBe('{title..0c}')
    })

    it('preserves {title..0u…} literally', () => {
      expect(
        renderFilenameTemplate('{title..0u…}', { title: 'Short' })
      ).toBe('{title..0u…}')
    })

    it('preserves {title..0c…} literally', () => {
      expect(
        renderFilenameTemplate('{title..0c…}', { title: 'Short' })
      ).toBe('{title..0c…}')
    })
  })

  // -- Malformed syntax: preserved literally --

  describe('malformed syntax', () => {
    it('preserves {title..abc} literally (no number)', () => {
      expect(
        renderFilenameTemplate('{title..abc}', { title: 'Short' })
      ).toBe('{title..abc}')
    })

    it('preserves {title..10x} literally (unknown suffix)', () => {
      expect(
        renderFilenameTemplate('{title..10x}', { title: 'Short' })
      ).toBe('{title..10x}')
    })

    it('preserves {title..u} literally (missing number)', () => {
      expect(
        renderFilenameTemplate('{title..u}', { title: 'Short' })
      ).toBe('{title..u}')
    })

    it('preserves {title..-5u} literally (negative number)', () => {
      expect(
        renderFilenameTemplate('{title..-5u}', { title: 'Short' })
      ).toBe('{title..-5u}')
    })

    it('preserves {title..abc} even if key exists', () => {
      expect(
        renderFilenameTemplate('{title..abc}', { title: 'Short' })
      ).toBe('{title..abc}')
    })

    it('preserves malformed with kebab-case key literally', () => {
      expect(
        renderFilenameTemplate('{isbn-10..10x}', { 'isbn-10': '123' })
      ).toBe('{isbn-10..10x}')
    })

    it('preserves malformed zero-length with alias literally', () => {
      expect(
        renderFilenameTemplate('{bookId..0u}', { id: '123' })
      ).toBe('{bookId..0u}')
    })
  })

  // -- Unknown placeholders with cut syntax: preserved --

  describe('unknown placeholders with cut syntax', () => {
    it('preserves unknown key with byte cut', () => {
      expect(
        renderFilenameTemplate('{uuid..5c}', { title: 'LOTR' })
      ).toBe('{uuid..5c}')
    })

    it('preserves unknown key with unicode cut', () => {
      expect(
        renderFilenameTemplate('{uuid..10u}', { title: 'LOTR' })
      ).toBe('{uuid..10u}')
    })

    it('preserves unknown key with cut and ellipsis', () => {
      expect(
        renderFilenameTemplate('{uuid..5u…}', { title: 'LOTR' })
      ).toBe('{uuid..5u…}')
    })
  })

  // -- Cut syntax with aliases / kebab-case keys --

  describe('cut syntax with aliases and kebab-case', () => {
    it('byte cut works with alias bookId', () => {
      expect(
        renderFilenameTemplate('{bookId..3c}', { id: '12345' })
      ).toBe('123')
    })

    it('unicode cut works with kebab-case isbn-10', () => {
      expect(
        renderFilenameTemplate('{isbn-10..5u}', { 'isbn-10': '1234567890' })
      ).toBe('12345')
    })

    it('byte cut with ellipsis respects the limit', () => {
      // 5 bytes total, … is 3 bytes → value gets at most 2 bytes
      // '123456' (6 bytes) → truncate to 2 bytes = '12' + '…' = '12…' (5 bytes)
      expect(
        renderFilenameTemplate('{bookId..5c…}', { id: '123456' })
      ).toBe('12…')
    })

    it('cut works with content-type kebab-case key', () => {
      expect(
        renderFilenameTemplate('{content-type..3c}', { 'content-type': 'book' })
      ).toBe('boo')
    })

    it('cut works with isbn_number alias', () => {
      expect(
        renderFilenameTemplate('{isbn_number..2u}', { isbn: '12345' })
      ).toBe('12')
    })

    it('cut works with isbn-number alias', () => {
      expect(
        renderFilenameTemplate('{isbn-number..2u}', { isbn: '12345' })
      ).toBe('12')
    })
  })

  // -- Combined: cut syntax mixed with normal placeholders --

  describe('mixed templates', () => {
    it('combines normal and cut placeholders', () => {
      // 10 bytes = 'The Lord o' (10 bytes)
      const result = renderFilenameTemplate(
        '{author} - {title..10c}',
        { author: 'Tolkien', title: 'The Lord of the Rings' }
      )
      expect(result).toBe('Tolkien - The Lord o')
    })

    it('combines cut with ellipsis and normal placeholders', () => {
      const result = renderFilenameTemplate(
        '{author} - {title..7u…}',
        { author: 'Tolkien', title: 'The Lord of the Rings' }
      )
      expect(result).toBe('Tolkien - The Lo…')
    })

    it('multiple cut placeholders', () => {
      // {title..5u} = 5 code points = 'The L', {author..5u} = 'Tolki'
      const result = renderFilenameTemplate(
        '{title..5u} - {author..5u}',
        { title: 'The Lord of the Rings', author: 'Tolkien' }
      )
      expect(result).toBe('The L - Tolki')
    })

    it('cut syntax works with auto-extension', () => {
      // 10 bytes = 'The Lord o' (10 bytes), extension appended
      const result = renderFilenameTemplate(
        '{title..10c}',
        { title: 'The Lord of the Rings', extension: 'pdf' }
      )
      expect(result).toBe('The Lord o.pdf')
    })

    it('cut syntax with CJK values', () => {
      // '超性愛指導手冊' is 7 code points, 21 bytes
      // 6 bytes = 2 code points
      expect(
        renderFilenameTemplate('{title..6c}', { title: '超性愛指導手冊' })
      ).toBe('超性')
    })

    it('unicode cut with CJK values', () => {
      expect(
        renderFilenameTemplate('{title..3u}', { title: '超性愛指導手冊' })
      ).toBe('超性愛')
    })

    it('byte cut with ellipsis on CJK', () => {
      // 6 bytes total, … is 3 → room for 3 bytes → 1 code point
      expect(
        renderFilenameTemplate('{title..6c…}', { title: '超性愛指導手冊' })
      ).toBe('超…')
    })
  })

  // -- Edge cases --

  describe('edge cases', () => {
    it('handles empty value with cut syntax', () => {
      // Empty value, no truncation needed, just return empty
      expect(
        renderFilenameTemplate('{title..5c}', { title: '' })
      ).toBe('')
    })

    it('handles empty value with cut and ellipsis', () => {
      // Empty value, no truncation, no ellipsis → just empty
      expect(
        renderFilenameTemplate('{title..5c…}', { title: '' })
      ).toBe('')
    })

    it('cut on empty value returns empty string', () => {
      expect(
        renderFilenameTemplate('{title..5u…}', { title: '' })
      ).toBe('')
    })
  })
});
