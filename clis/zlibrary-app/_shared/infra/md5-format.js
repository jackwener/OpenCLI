/**
 * CDN MD5 Tag Helpers
 *
 * Single source of truth for the Z-Library CDN `_MD5_%m_` tag pattern.
 * This tag appears in the CDN redirect URL's `filename` query parameter
 * when the user's profile has MD5 enabled. `%m` is Z-Library's format code
 * for MD5 hash.
 *
 * This tag is for CDN extraction ONLY. Filename scanning/pattern matching
 * for booklist download dedup uses its own inline regexes in
 * booklist-download.js  -  those are a separate concern.
 */

// CDN tag: %m is Z-Library's format code for md5
export const MD5_FILENAME_TAG = '_MD5_%m_'

// CDN extraction regex: /_MD5_([a-f0-9]{32})_/i
// Built from MD5_FILENAME_TAG by replacing %m with hex capture group
export const CDN_MD5_TAG_RE = new RegExp(
  MD5_FILENAME_TAG.replace('%m', '([a-f0-9]{32})'),
  'i'
)

// Profile API format string (uses Z-Library %t %a %m codes)
export const PROFILE_MD5_FILENAME_FORMAT_API = '%t (%a)' + MD5_FILENAME_TAG

// Display format for CLI output (derived from API format)
export const PROFILE_MD5_FILENAME_FORMAT_DISPLAY = PROFILE_MD5_FILENAME_FORMAT_API
  .replace(/%t/g, '{Title}')
  .replace(/%a/g, '{Author}')
  .replace(/%m/g, '{md5}')

/**
 * Check if text contains an MD5 placeholder.
 * Derives the desugared tag from MD5_FILENAME_TAG for DOM-extracted strings,
 * and also checks for raw %m for API/quota-extracted strings.
 */
export function hasMd5InFilenameFormat(text) {
  if (!text) return false
  const t = String(text)
  // Desugared DOM format: _MD5_{md5}_
  const tagDesugared = MD5_FILENAME_TAG.replace('%m', '{md5}')
  // Raw API/quota format: _MD5_%m_ (or %m somewhere)
  return t.includes(tagDesugared) || t.includes('%m')
}

/**
 * Format MD5 tag: replace %m with the hex value.
 * @param {string} md5 - 32-char hex MD5 string
 * @returns {string} e.g. '_MD5_a1b2c3..._'
 */
export function formatMd5Tag(md5) {
  return MD5_FILENAME_TAG.replace('%m', String(md5 || '').toLowerCase())
}

/**
 * Extract MD5 from CDN URL filename param using CDN_MD5_TAG_RE.
 * Requires full `_MD5_<32hex>_` with trailing `_`.
 * @param {string} text - Text to search (e.g. CDN filename param value)
 * @returns {string} Lowercased hex MD5, or '' if not found
 */
export function extractCdnMd5Tag(text) {
  if (!text) return ''
  const match = String(text).match(CDN_MD5_TAG_RE)
  return match ? match[1].toLowerCase() : ''
}

/**
 * Extract CDN filename MD5 from a redirect URL's `filename` query parameter.
 *
 * When the user's Z-Library profile has a filename template that includes
 * {md5}, the CDN download URL will contain a `filename` param like:
 *   filename=Nineteen+Eighty-Four+%28Orwell%29__MD5_902346f6a7bda266effdb11e163d36f2__.epub
 *
 * This extracts the 32-hex MD5 from the __MD5_<32hex>__ tag.
 *
 * @param {string} url - The CDN redirect URL (absolute)
 * @returns {string} - Extracted MD5 hex string, or empty string if not found
 */
export function extractMd5FromCdnFilenameParam (url) {
  try {
    const filename = new URL(url).searchParams.get('filename')
    return extractCdnMd5Tag(filename)
  } catch {
    return ''
  }
}

/**
 * OBSOLETED MD5 extraction — returns caller's fallbackMd5.
 *
 * Previously extracted MD5 from DOM <meta name="propeller"> and /dl/<32hex>/
 * URL patterns. Both sources were permanently removed (see AGENTS.md for
 * full rationale).
 *
 * Real MD5 flow: API's book.md5 → metadata.md5 → download verification.
 * This function now just passes through the caller's fallbackMd5 for backward
 * compatibility.
 *
 * Used only from booklist-download.js and search.js for backward-compatible
 * MD5 pass-through.
 *
 * Kept for backward-compatible signature only; page and downloadUrl are
 * intentionally unused.
 *
 * @param {*} _page - Unused (kept for backward-compatible signature)
 * @param {object} [options]
 * @param {string} [options.downloadUrl] - Unused
 * @param {string} [options.fallbackMd5] - Fallback MD5 to return
 * @returns {Promise<string>} The fallback MD5, or ''
 */
export async function extractBookMd5 (_page, { downloadUrl: _downloadUrl, fallbackMd5 } = {}) {
  // _page and _downloadUrl kept for backward-compatible signature only
  if (fallbackMd5) return fallbackMd5
  return ''
}
