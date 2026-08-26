/**
 * Z-Library adapter utilities.
 */

import { ArgumentError } from '@jackwener/opencli/errors';
import {
  extractSearchResults,
  extractBookTitle,
  extractFormats,
  EXTS,
  LANGS,
  CONTENT_TYPES,
  LANGUAGE_BY_CODE,
  fmtBytes,
  validateLanguage,
  validateExtension,
  validateContentType,
} from './dom.js';

const ZLIBRARY_DOMAIN = 'z-library.im';
const ZLIBRARY_ORIGIN = `https://${ZLIBRARY_DOMAIN}`;
const ZLIBRARY_ALLOWED_HOSTS = new Set([
  ZLIBRARY_DOMAIN,
  `www.${ZLIBRARY_DOMAIN}`,
]);

/**
 * Parse a URL with optional base, returning null on failure.
 *
 * @param {string} href
 * @param {string} [base]
 * @returns {URL|null}
 */
export function parseUrl(href, base) {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/**
 * Check whether a URL uses http or https protocol.
 *
 * @param {URL} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export function normalizeZlibraryBookUrl(input) {
  const raw = String(input || '').trim();
  const url = parseUrl(raw);
  if (!url || !isHttpUrl(url) || !ZLIBRARY_ALLOWED_HOSTS.has(url.hostname)) {
    throw new ArgumentError(
      `Unsupported Z-Library URL: ${raw}`,
      `Pass a book URL under ${ZLIBRARY_DOMAIN}, for example ${ZLIBRARY_ORIGIN}/book/...`,
    );
  }
  return url.toString();
}

/**
 * Build a Z-Library search URL.
 * Z-Library uses /s/<url-encoded-query> for search.
 */
export function buildSearchUrl(query) {
  const normalized = String(query || '').trim();
  if (!normalized) {
    throw new ArgumentError('zlibrary search query cannot be empty');
  }
  return `${ZLIBRARY_ORIGIN}/s/${encodeURIComponent(normalized)}`;
}

export {
  extractSearchResults,
  extractBookTitle,
  extractFormats,
  EXTS,
  LANGS,
  CONTENT_TYPES,
  LANGUAGE_BY_CODE,
  fmtBytes,
  validateLanguage,
  validateExtension,
  validateContentType,
};

export { ZLIBRARY_DOMAIN, ZLIBRARY_ORIGIN };
