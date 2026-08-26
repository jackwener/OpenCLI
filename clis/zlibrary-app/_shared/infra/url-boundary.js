/**
 * URL Trust Boundary Module for Z-Library Desktop.
 *
 * Consolidates same-origin + http(s) URL validation logic scattered
 * across download.js, booklist-download.js, booklist-show.js,
 * booklist-api.js, and book-selector.js.
 *
 * All URL sanitization that crosses the CDP boundary must go through
 * these helpers to ensure consistent security semantics.
 *
 * Data flow:
 *   user input → origin validation → internal relative → output absolute HTTP(S)
 *
 * @module url-boundary
 */

import { ArgumentError, CommandExecutionError, LoginWallError } from '@jackwener/opencli/errors'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw URL against a known origin and return an absolute same-origin
 * HTTP(S) URL, or '' if validation fails.
 *
 * Handles:
 *   - Absolute URLs → check same-origin + http(s) → return href
 *   - Relative URLs (/path) → resolve against origin → return absolute
 *   - Malformed URLs → return ''
 *   - Non-http(s) URLs (javascript:, data:, file:, electron:) → return ''
 *   - Cross-origin URLs → return ''
 *
 * @param {string|null|undefined} rawUrl - Raw URL from user/DOM/API
 * @param {string} origin - Page origin (e.g. 'https://z-lib.gl')
 * @returns {string} - Absolute HTTP(S) URL or ''
 */
export function toSameOriginAbsoluteUrl(rawUrl, origin) {
  if (!rawUrl || !origin) return ''
  const str = String(rawUrl).trim()
  if (!str) return ''

  // Reject if it doesn't start with a recognizable URL pattern.
  // This prevents arbitrary strings (e.g. "not a url at all!!!") from
  // being incorrectly resolved as relative paths via new URL(str, origin).
  if (!str.startsWith('http://') && !str.startsWith('https://') && !str.startsWith('/')) return ''

  try {
    const resolved = new URL(str, origin)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return ''
    if (resolved.origin !== origin) return ''
    return resolved.href
  } catch {
    return ''
  }
}

/**
 * Validate that a raw URL is a same-origin HTTP(S) URL, throwing
 * ArgumentError with a descriptive message on failure.
 *
 * @param {string|null|undefined} rawUrl - Raw URL from user input
 * @param {string} origin - Page origin (e.g. 'https://z-lib.gl')
 * @param {string} [label='URL'] - Label for error messages
 * @returns {string} - The validated absolute HTTP(S) URL
 * @throws {ArgumentError}
 */
export function assertSameOriginHttpUrl(rawUrl, origin, label = 'URL') {
  const result = toSameOriginAbsoluteUrl(rawUrl, origin)
  if (!result) {
    throw new ArgumentError(
      `${label} must be a same-origin HTTP(S) URL`,
      `Expected origin: ${origin}` +
        (rawUrl ? `, got: ${String(rawUrl).slice(0, 200)}` : '')
    )
  }
  return result
}

/**
 * Convert an absolute book URL to an internal relative URL.
 *
 * Strips the scheme and origin, keeping path + search + hash.
 * Used by resolveBookSelector when handling absolute user-provided URLs.
 *
 * @param {string} rawBookUrl - Absolute URL to a book page
 * @returns {{ urlRelative: string, originalOrigin: string }}
 * @throws {ArgumentError} - If URL is not http(s) or not a /book/ path
 */
export function toBookUrlRelative(rawBookUrl) {
  if (!rawBookUrl) {
    throw new ArgumentError('Book URL is required')
  }

  let parsed
  try {
    parsed = new URL(String(rawBookUrl))
  } catch {
    throw new ArgumentError(
      'Invalid book URL',
      'Got unparseable URL: ' + String(rawBookUrl).slice(0, 200)
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ArgumentError(
      'Book URL must use http or https protocol',
      'Got: ' + parsed.protocol
    )
  }

  const urlRelative = parsed.pathname + parsed.search + parsed.hash
  if (!urlRelative.startsWith('/book/')) {
    throw new ArgumentError(
      'Book URL must have a /book/ path',
      'Got: ' + parsed.pathname
    )
  }

  return { urlRelative, originalOrigin: parsed.origin }
}

/**
 * Build a JavaScript expression for use inside page.evaluate() that
 * validates a URL is same-origin + http(s).
 *
 * The returned expression sets a variable `${urlVar}_sameOrigin` to
 * the validated absolute URL, or '' if validation fails.
 *
 * Usage inside an evaluate script:
 * ```javascript
 * const snippet = buildEvaluateSameOriginUrlSnippet('targetUrl', 'origin');
 * // Produces: var targetUrl_sameOrigin = ''; try { ... } catch(e) {}
 * ```
 *
 * @param {string} urlVar - Variable name holding the URL to validate
 * @param {string} originVar - Variable name holding the page origin
 * @returns {string} - JavaScript snippet
 */
export function buildEvaluateSameOriginUrlSnippet(urlVar, originVar) {
  return (
    'var ' + urlVar + '_sameOrigin = ' +
    '(function(u, o) { try { var p = new URL(u, o); ' +
    'if (p.origin === o && (p.protocol === "http:" || p.protocol === "https:")) return p.href; ' +
    '} catch(e) {} return ""; })(' + urlVar + ', ' + originVar + ');'
  )
}

// ---------------------------------------------------------------------------
// Page-level URL trust boundary helpers
// ---------------------------------------------------------------------------

/**
 * Get the current page origin and validate it is http(s).
 *
 * Uses `new URL()` structural parsing (not `startsWith('http')`) to enforce
 * the URL trust boundary. Rejects `file://`, `javascript:`, `about:`, etc.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<URL>} Validated origin URL object
 * @throws {CommandExecutionError} If origin is missing, unparseable, or non-http(s)
 */
export async function getCurrentHttpOrigin(page) {
  const rawOrigin = String(await page.evaluate('window.location.origin') || '')
  let origin
  try {
    origin = new URL(rawOrigin)
  } catch {
    throw new CommandExecutionError(
      'Not connected to a Z-Library page (invalid origin: ' + (rawOrigin || 'null') + ').',
      'The app may be showing a loading screen. Wait for it to finish loading and retry.'
    )
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new CommandExecutionError(
      'Not connected to a Z-Library page (current page origin: ' + origin.origin + '). ' +
      'Please navigate the Z-Library app to a Z-Library website page and try again.',
      'The app may be showing a loading screen. Wait for it to finish loading and retry.'
    )
  }
  return origin
}

/**
 * Assert that the current page URL is same-origin with the expected origin
 * and not a login wall.
 *
 * Must be called AFTER navigation (page.goto) to verify the trust boundary
 * was not violated by a redirect.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {URL} startOrigin - The validated origin from getCurrentHttpOrigin()
 * @param {string} [commandName='zlibrary-app'] - Command name for error messages
 * @returns {Promise<URL>} The validated final URL
 * @throws {CommandExecutionError} If redirected to a different origin
 * @throws {LoginWallError} If redirected to a login page
 */
export async function assertSameOriginNotLoginWall(page, startOrigin, commandName) {
  const rawFinalUrl = String(await page.evaluate('window.location.href'))
  let finalUrl
  try {
    finalUrl = new URL(rawFinalUrl)
  } catch {
    throw new CommandExecutionError(
      'Navigation resulted in an invalid URL.',
      'The page may have redirected to an unexpected location. Try again.'
    )
  }
  if (finalUrl.origin !== startOrigin.origin) {
    throw new CommandExecutionError(
      'Redirected to a different origin after navigation (expected ' + startOrigin.origin +
      ', got ' + finalUrl.origin + ').',
      'The page may have redirected outside the ' + (commandName || 'zlibrary-app') + ' site. Try again.'
    )
  }
  if (finalUrl.pathname === '/login' || finalUrl.pathname.startsWith('/login/')) {
    throw new LoginWallError(
      'Login required to search Z-Library',
      403,
      finalUrl.href,
      'Login wall detected after navigation to ' + finalUrl.pathname
    )
  }
  return finalUrl
}

/**
 * Check if a pathname represents a login wall.
 *
 * Uses exact pathname matching (`/login`) and prefix matching (`/login/`)
 * rather than substring `includes('/login')` to avoid false positives
 * on paths like `/book/login-required-title`.
 *
 * @param {string} pathname - URL pathname to check
 * @returns {boolean}
 */
export function isLoginWallPath(pathname) {
  return pathname === '/login' || pathname.startsWith('/login/')
}

// ---------------------------------------------------------------------------
// Download URL trust boundary helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a final download URL is HTTPS.
 * Throws if the URL is not HTTPS or is invalid.
 *
 * @param {string} url - Final URL after redirects (e.g., CDN URL)
 * @returns {string} The validated HTTPS URL
 * @throws {ArgumentError} If URL is not HTTPS or invalid
 */
export function assertHttpsFinalUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new ArgumentError('Final URL must be a non-empty string')
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      throw new ArgumentError('Final download URL must be HTTPS', `Got: ${parsed.protocol}`)
    }
    return parsed.href
  } catch {
    throw new ArgumentError('Final download URL is not a valid URL', `Got: ${url}`)
  }
}

/**
 * Convert an absolute download URL to an internal relative URL for download requests.
 * Preserves pathname + search (query string), not just pathname.
 * Used for /dl/* download URLs to construct urlRelative for CDP Fetch.
 *
 * @param {string} url - Absolute download URL
 * @param {string} origin - Page origin (e.g., 'https://z-lib.gl')
 * @returns {string} Relative URL (pathname + search)
 * @throws {ArgumentError} If URL is not same-origin HTTPS
 */
export function toDownloadUrlRelative(url, origin) {
  if (!url || !origin) {
    throw new ArgumentError('URL and origin are required')
  }
  const absolute = toSameOriginAbsoluteUrl(url, origin)
  if (!absolute) {
    throw new ArgumentError('Download URL must be same-origin HTTPS', `Expected origin: ${origin}, got: ${url}`)
  }
  const parsed = new URL(absolute)
  return parsed.pathname + parsed.search
}

/**
 * Sanitize a download URL for trace artifacts by redacting /dl/<token> paths.
 * Replaces the token portion with '...' for privacy in logs/fixtures.
 * Only allows HTTPS URLs; returns empty string for invalid or non-HTTPS URLs.
 *
 * @param {string|null|undefined} url - URL to sanitize
 * @returns {string} Sanitized URL or empty string
 */
export function sanitizeDownloadTraceUrl(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return ''
    // Redact /dl/<token> pattern
    const redacted = parsed.pathname.replace(/\/dl\/[^/]+/, '/dl/...')
    return parsed.origin + redacted + parsed.search + parsed.hash
  } catch {
    return ''
  }
}
