import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { EmptyResultError, ArgumentError, LoginWallError, CommandExecutionError } from '@jackwener/opencli/errors'
import { createInfoCommandPage } from './_shared/test/test-utils-search.js'
import { createPageMock } from '../test-utils.js'
import './info.js'

describe('zlibrary-app info', () => {
  it('returns download formats for the currently viewed book', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Format URLs are resolved to absolute same-origin HTTP(S) URLs
    // inside extractFormats's evaluate script before crossing the CDP boundary.
    // Mock data uses absolute URLs to match production behavior.
    const page = createInfoCommandPage({
      origin: 'https://z-lib.sk',
      title: 'The Great Book',
      formats: { pdf: 'https://zlibrary.local/dl/pdf', epub: '', azw3: '', mobi: '' }
    })

    const result = await command.func(page, {})

    expect(result).toEqual([{
      title: 'The Great Book',
      pdf: 'https://zlibrary.local/dl/pdf',
      epub: '',
      azw3: '',
      mobi: '',
      publisher: '',
      isbn: '',
      pages: '',
      isbn10: '',
      isbn13: '',
      series: '',
      volume: '',
      categories: '',
      description: '',
    }])
  })

  // -- --book-id support ----------------------------------------------------

  it('accepts --book-id with numeric ID and navigates before extracting info', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Numeric ID: navigateToBookSelector → goto(/book/12345) → then extract title + formats
    const page = createInfoCommandPage({
      origin: 'https://z-lib.sk',
      title: 'Custom Book Title',
      formats: { pdf: 'https://zlibrary.local/dl/pdf123', epub: '', azw3: '', mobi: '' },
      href: 'https://z-lib.sk/book/12345'
    })

    const result = await command.func(page, { 'book-id': '12345' })
    expect(result).toEqual([{
      title: 'Custom Book Title',
      pdf: 'https://zlibrary.local/dl/pdf123',
      epub: '',
      azw3: '',
      mobi: '',
      publisher: '',
      isbn: '',
      pages: '',
      isbn10: '',
      isbn13: '',
      series: '',
      volume: '',
      categories: '',
      description: '',
    }])
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.sk/book/12345', expect.any(Object))
  })

  it('accepts --book-id with relative URL and navigates before extracting info', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Relative URL: no origin check needed (originalOrigin is empty)
    const page = createInfoCommandPage({
      origin: 'https://z-lib.sk',
      title: 'URL Book Title',
      formats: { pdf: '', epub: 'https://zlibrary.local/dl/epub456', azw3: '', mobi: '' },
      href: 'https://z-lib.sk/book/demo'
    })

    const result = await command.func(page, { 'book-id': '/book/demo' })
    expect(result).toEqual([{
      title: 'URL Book Title',
      pdf: '',
      epub: 'https://zlibrary.local/dl/epub456',
      azw3: '',
      mobi: '',
      publisher: '',
      isbn: '',
      pages: '',
      isbn10: '',
      isbn13: '',
      series: '',
      volume: '',
      categories: '',
      description: '',
    }])
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.sk/book/demo', expect.any(Object))
  })

  it('accepts --book-id with absolute https URL (same origin)', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Absolute URL: origin check → goto(/book/abs123) → post-navigation check → extract
    const page = createInfoCommandPage({
      origin: 'https://z-lib.org',
      title: 'Abs URL Book',
      formats: { pdf: 'https://z-lib.org/dl/pdfabs', epub: '', azw3: '', mobi: '' },
      selector: { origin: 'https://z-lib.org' },
      href: 'https://z-lib.org/book/abs123'
    })

    const result = await command.func(page, { 'book-id': 'https://z-lib.org/book/abs123' })
    expect(result[0].title).toBe('Abs URL Book')
    expect(page.goto).toHaveBeenCalledWith('https://z-lib.org/book/abs123', expect.any(Object))
  })

  it('rejects --book-id with cross-origin absolute URL', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Cross-origin: origin check returns local origin → mismatch before navigation
    const page = createInfoCommandPage({
      origin: 'https://frenchbooks.sk',
      selector: { origin: 'https://frenchbooks.sk' }
    })

    await expect(
      command.func(page, { 'book-id': 'https://evil.com/book/12345' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/same-site|Expected origin/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('throws ArgumentError for invalid --book-id value', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Provide a valid origin for getCurrentHttpOrigin; error comes from resolveBookSelector
    const page = createPageMock(['https://z-lib.sk'])
    await expect(
      command.func(page, { 'book-id': 'not-a-valid-id' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/must be a numeric book ID/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('throws ArgumentError for javascript: URL in --book-id', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    // Provide a valid origin for getCurrentHttpOrigin; error comes from resolveBookSelector
    const page = createPageMock(['https://z-lib.sk'])
    await expect(
      command.func(page, { 'book-id': 'javascript:alert(1)' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/must be a numeric book ID/)
    })
    expect(page.goto).not.toHaveBeenCalled()
  })

  // -- Existing behavior ----------------------------------------------------

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    const page = createInfoCommandPage({
      origin: 'https://z-lib.sk',
      title: 'A Book',
      formats: { pdf: 'https://zlibrary.local/dl/p', epub: '', azw3: '', mobi: '' }
    })
    const [row] = await command.func(page, {})
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('throws EmptyResultError when no book is selected and no --book-id', async () => {
    const command = getRegistry().get('zlibrary-app/info')
    const page = createInfoCommandPage({
      origin: 'https://z-lib.sk',
      title: '',
      formats: { pdf: '', epub: '', azw3: '', mobi: '' }
    })

    await expect(command.func(page, {})).rejects.toBeInstanceOf(EmptyResultError)
  })

  // -- --detail flag ---------------------------------------------------------

  describe('--detail', () => {
    it('includes detail attributes when --detail is set', async () => {
      const command = getRegistry().get('zlibrary-app/info')
      const page = createInfoCommandPage({
        origin: 'https://z-lib.sk',
        title: 'Detailed Book',
        formats: { pdf: 'https://zlibrary.local/dl/p', epub: '', azw3: '', mobi: '' },
        detailAttr: {
          pages: '350',
          isbn10: '1234567890',
          isbn13: '9781234567890',
          series: 'The Great Series',
          volume: 'Vol. 3',
          categories: 'Fiction, Mystery',
          description: 'A detailed description of the book.',
        }
      })

      const result = await command.func(page, { detail: true })

      expect(result).toEqual([{
        title: 'Detailed Book',
        pdf: 'https://zlibrary.local/dl/p',
        epub: '',
        azw3: '',
        mobi: '',
        publisher: '',
        isbn: '',
        pages: '350',
        isbn10: '1234567890',
        isbn13: '9781234567890',
        series: 'The Great Series',
        volume: 'Vol. 3',
        categories: 'Fiction, Mystery',
        description: 'A detailed description of the book.',
      }])
    })

    it('returns empty detail fields when metadata is missing', async () => {
      const command = getRegistry().get('zlibrary-app/info')
      const page = createInfoCommandPage({
        origin: 'https://z-lib.sk',
        title: 'Minimal Book',
        formats: { pdf: '', epub: '', azw3: '', mobi: '' },
        detailAttr: {
          pages: '',
          isbn10: '',
          isbn13: '',
          series: '',
          volume: '',
          categories: '',
          description: '',
        }
      })

      const result = await command.func(page, { detail: true })

      expect(result).toEqual([{
        title: 'Minimal Book',
        pdf: '',
        epub: '',
        azw3: '',
        mobi: '',
        publisher: '',
        isbn: '',
        pages: '',
        isbn10: '',
        isbn13: '',
        series: '',
        volume: '',
        categories: '',
        description: '',
      }])
    })

    it('declared columns match returned object keys with --detail', async () => {
      const command = getRegistry().get('zlibrary-app/info')
      const page = createInfoCommandPage({
        origin: 'https://z-lib.sk',
        title: 'A Book',
        formats: { pdf: '', epub: '', azw3: '', mobi: '' },
        detailAttr: {
          pages: '200',
          isbn10: '',
          isbn13: '',
          series: '',
          volume: '',
          categories: '',
          description: '',
        }
      })
      const [row] = await command.func(page, { detail: true })
      const returnedKeys = Object.keys(row).sort()
      const declaredColumns = [...command.columns].sort()
      expect(returnedKeys).toEqual(declaredColumns)
    })

    // -- Post-navigation validation (P1) -----------------------------------

    it('throws LoginWallError when --book-id navigation redirects to /login', async () => {
      const command = getRegistry().get('zlibrary-app/info')
      const page = createInfoCommandPage({
        origin: 'https://z-lib.sk',
        title: '',
        formats: { pdf: '', epub: '', azw3: '', mobi: '' },
        href: 'https://z-lib.sk/login'
      })

      await expect(
        command.func(page, { 'book-id': '12345' })
      ).rejects.toBeInstanceOf(LoginWallError)
      expect(page.goto).toHaveBeenCalledWith('https://z-lib.sk/book/12345', expect.any(Object))
    })

    it('throws CommandExecutionError when --book-id navigation redirects cross-origin', async () => {
      const command = getRegistry().get('zlibrary-app/info')
      const page = createInfoCommandPage({
        origin: 'https://z-lib.sk',
        title: '',
        formats: { pdf: '', epub: '', azw3: '', mobi: '' },
        href: 'https://evil.com/book/12345'
      })

      await expect(
        command.func(page, { 'book-id': '12345' })
      ).rejects.toBeInstanceOf(CommandExecutionError)
      expect(page.goto).toHaveBeenCalledWith('https://z-lib.sk/book/12345', expect.any(Object))
    })
  })
})