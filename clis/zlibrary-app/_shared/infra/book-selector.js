/**
 * Book selector resolver for Z-Library Desktop commands.
 *
 * Pure syntax-validator that resolves user input from --book-id into
 * either a numeric book ID or a relative book URL.
 *
 * Security validation (scheme, path) is done here for syntax;
 * same-origin validation against the current page is done in
 * validateBookSelectorOrigin() and navigateToBookSelector().
 *
 * @module book-selector
 */

import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { toBookUrlRelative } from './url-boundary.js'

/**
 * Parse book ID from a /book/{id}/... URL path.
 *
 * Extracts the simple ID (e.g. DjEXwd1ZRo) from a Z-Library book URL path
 * without requiring browser navigation.
 *
 * @param {string} urlRelative - Relative URL path (e.g. '/book/DjEXwd1ZRo/title.html')
 * @returns {string} - The parsed simple book ID
 * @throws {ArgumentError} - If the path doesn't match the expected format
 */
export function parseBookIdFromUrlPath(urlRelative) {
  // Use a safe base URL to parse relative paths
  const safeBase = 'https://safe-base.invalid'
  let pathname
  try {
    pathname = new URL(urlRelative, safeBase).pathname
  } catch {
    throw new ArgumentError(
      'Invalid book URL path',
      `Expected /book/{id}/... format, got: ${urlRelative}`
    )
  }

  // Split path into segments: ['', 'book', 'DjEXwd1ZRo', 'title.html']
  const segments = pathname.split('/').filter(Boolean)

  if (segments[0] !== 'book' || !segments[1]) {
    throw new ArgumentError(
      'Book URL must have a /book/ path',
      `Expected /book/{id}/... format, got: ${pathname}`
    )
  }

  // Decode the ID segment (handles %2E in encoded paths)
  const bookId = decodeURIComponent(segments[1])

  // Validate ID charset (simple IDs are alphanumeric + hyphen)
  if (!/^[A-Za-z0-9_-]+$/.test(bookId)) {
    throw new ArgumentError(
      'Invalid Z-Library book ID in URL path',
      `Expected simple book ID (e.g. DjEXwd1ZRo), got: ${bookId}. Use a full book URL from search output.`
    )
  }

  // Z-Library book URLs use simple IDs (not numeric regular IDs).
  if (/^\d+$/.test(bookId)) {
    throw new ArgumentError(
      'Invalid Z-Library book ID in URL path',
      `Expected simple book ID from search output (e.g. DjEXwd1ZRo), got numeric ID: ${bookId}. Use the full --book-url from zlibrary-app search.`
    )
  }

  return bookId
}

/** Safe base for relative URL normalization (never actually fetched) */
const SAFE_BASE = 'https://safe-base.invalid'

// ---------------------------------------------------------------------------
// Resolver (pure  -  no page dependency)
// ---------------------------------------------------------------------------

/**
 * Resolve a raw --book-id value into a typed selector.
 *
 * Auto-detection priority:
 *   1. Blank - ArgumentError
  *   2. Starts with https?:// - absolute URL - validate scheme + path - return relative URL
  *   3. Starts with / - relative URL - validate starts with /book/
  *   4. Matches /^\d+$/ - numeric ID
  *   5. Else - ArgumentError
 *
 * @param {string} rawValue - raw user input from --book-id
 * @param {string} [optionName='--book-id'] - flag name for error messages
 * @returns {{ kind: 'id', bookId: string } | { kind: 'url', urlRelative: string, originalOrigin: string }}
 * @throws {ArgumentError}
 */
export function resolveBookSelector(rawValue, optionName = '--book-id') {
  const trimmed = String(rawValue == null ? '' : rawValue).trim()
  if (!trimmed) {
    throw new ArgumentError(`${optionName} is required`)
  }

  // -- 1. Absolute URL: starts with http:// or https:// --------------
  if (/^https?:\/\//i.test(trimmed)) {
    // Delegates to url-boundary.js for consistent URL validation
    const result = toBookUrlRelative(trimmed)
    return { kind: 'url', urlRelative: result.urlRelative, originalOrigin: result.originalOrigin }
  }

  // -- 2. Relative URL: starts with / --------------------------------
  if (trimmed.startsWith('/')) {
    let resolved
    try {
      resolved = new URL(trimmed, SAFE_BASE)
    } catch {
      throw new ArgumentError(
        `${optionName} must be a numeric book ID or same-site Z-Library book URL`,
        'Got unparseable relative URL: ' + trimmed,
      )
    }

    const pathname = resolved.pathname // normalized: /book/../search → /search

    // Check normalized path (catches /book/../search → /search)
    if (!pathname.startsWith('/book/')) {
      throw new ArgumentError(
        `${optionName} must be a numeric book ID or same-site Z-Library book URL`,
        'Expected a book URL path starting with /book/, got: ' + pathname,
      )
    }

    // Check decoded-normalized path (catches /book/%2e%2e/search encoded traversal)
    const decoded = decodeURIComponent(pathname)
    if (decoded !== pathname) {
      try {
        const normalizedDecoded = new URL(decoded, SAFE_BASE).pathname
        if (!normalizedDecoded.startsWith('/book/')) {
          throw new ArgumentError(
            `${optionName} must be a numeric book ID or same-site Z-Library book URL`,
            'Expected a book URL path starting with /book/, got: ' + pathname,
          )
        }
      } catch {
        throw new ArgumentError(
          `${optionName} must be a numeric book ID or same-site Z-Library book URL`,
          'Got unparseable relative URL: ' + trimmed,
        )
      }
    }

    return { kind: 'url', urlRelative: pathname + resolved.search + resolved.hash, originalOrigin: '' }
  }

  // -- 3. Numeric ID -------------------------------------------------
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'id', bookId: trimmed }
  }

  // -- 4. Unknown format ---------------------------------------------
  throw new ArgumentError(
    `${optionName} must be a numeric book ID or same-site Z-Library book URL`,
    'Use a numeric ID (e.g. 5433175) or a book URL (/book/demo or https://z-lib.org/book/12345)',
  )
}

// ---------------------------------------------------------------------------
// Origin validation (requires page access)
// ---------------------------------------------------------------------------

/**
 * Validate that an absolute URL's origin matches the current page origin.
 *
 * Per the URL security boundary spec, cross-origin absolute URLs must be
 * rejected with ArgumentError. Relative URLs (originalOrigin === '') are
 * always valid since they resolve against the current page origin.
 *
 * Must be called before navigating to the URL.
 *
 * @param {{ kind: 'id', bookId: string } | { kind: 'url', urlRelative: string, originalOrigin: string }} selector
 * @param {string} pageOrigin  -  the current page's origin (from window.location.origin)
 * @param {string} [optionName='--book-id']  -  flag name for error messages
 * @throws {ArgumentError}
 */
export function validateBookSelectorOrigin(selector, pageOrigin, optionName = '--book-id') {
  if (selector.kind === 'url' && selector.originalOrigin && selector.originalOrigin !== pageOrigin) {
    throw new ArgumentError(
      `${optionName} must be a same-site Z-Library book URL`,
      `Expected origin: ${pageOrigin}, got: ${selector.originalOrigin}. Use a relative URL (/book/...) or a URL from the current site.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Page-dependent helper
// ---------------------------------------------------------------------------

/**
 * Navigate to a resolved book selector (URL or ID).
 *
 * Uses relative path navigation  -  internal layers keep same-site
 * resources as relative URLs per the URL security boundary spec.
 * Playwright resolves relative paths against the current page origin automatically.
 *
 * If the selector came from an absolute URL, validates same-origin first.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{ kind: 'id', bookId: string } | { kind: 'url', urlRelative: string, originalOrigin: string }} selector
 * @throws {ArgumentError}  -  if absolute URL origin doesn't match current page
 */
export async function navigateToBookSelector(page, selector) {
  // Validate same-origin for absolute user URLs before navigation
  if (selector.kind === 'url' && selector.originalOrigin) {
    const pageOrigin = String(await page.evaluate('window.location.origin') || '')
    validateBookSelectorOrigin(selector, pageOrigin)
  }

  // Navigate with resolved absolute URL (CDP Page.navigate requires absolute URLs)
  const targetPath = selector.kind === 'url' ? selector.urlRelative : '/book/' + selector.bookId
  const pageOrigin = String(await page.evaluate('window.location.origin') || '')
  const targetUrl = new URL(targetPath, pageOrigin).href

  await page.goto(targetUrl, { waitUntil: 'load', settleMs: 2000 })
  await page.wait(1.5)
}

/**
 * Extract book ID from the current page's <z-bookcard> element.
 *
 * Assumes the page is already on a book detail page with a <z-bookcard>
 * element present. Must be called after navigateToBookSelector.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}  -  the extracted numeric book ID
 * @throws {CommandExecutionError}  -  if no <z-bookcard> found on the page
 */
export async function extractCurrentBookId(page) {
  const bookId = String(
    await page.evaluate(`
      (() => {
        var card = document.querySelector('z-bookcard');
        return card ? card.getAttribute('id') || '' : '';
      })()
    `) || '',
  ).trim()

  if (!bookId) {
    throw new CommandExecutionError(
      'Could not find book ID on the page',
      'Make sure the URL points to a valid Z-Library page.',
    )
  }

  return bookId
}

/**
 * Navigate to a resolved selector (URL or ID) and extract the book's
 * numeric ID from the <z-bookcard> element on the resulting page.
 *
 * Convenience wrapper around navigateToBookSelector + extractCurrentBookId.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{ kind: 'id', bookId: string } | { kind: 'url', urlRelative: string, originalOrigin: string }} selector
 * @returns {Promise<string>}  -  the extracted numeric book ID
 * @throws {ArgumentError}  -  if absolute URL origin doesn't match current page
 * @throws {CommandExecutionError}  -  if navigation fails or no card found
 */
export async function navigateAndExtractBookId(page, selector) {
  await navigateToBookSelector(page, selector)
  return extractCurrentBookId(page)
}
