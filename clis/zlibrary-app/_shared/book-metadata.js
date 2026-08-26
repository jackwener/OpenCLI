/**
 * Book metadata assembly and extraction helpers for zlibrary-app.
 *
 * Aggregates DOM-extracted book fields (title, author, language, etc.) into a
 * single metadata object used for filename template rendering and CLI output.
 *
 * Imported by:
 *   - utils.js (re-exported for backward compat during migration)
 *   - Commands that need rich book metadata (download, booklist-download, search)
 */

import {
  extractBookTitle,
  extractBookAuthor,
  extractBookLanguage,
  extractBookFormatQualityRating,
  extractBookCardAttributes,
  extractBookDetailAttributes,
  languageCodeByName,
} from '../../zlibrary/dom.js'
import { normalizeAuthorCredit } from './infra/manifest-helpers.js'

/**
 * Extract rich metadata from a book's detail page.
 *
 * Calls all DOM extractors in parallel, then merges results with fallback
 * defaults. Returned object contains all fields needed for
 * FILENAME_TEMPLATE_DEFAULT rendering.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {object} [defaults] — Fallback values (e.g. from booklist API row)
 * @returns {Promise<{
 *   title: string, author: string, language: string, languageCode: string,
 *   year: string, filesize: string, extension: string, rating: string,
 *   formatQualityRating: string, publisher: string, isbn: string,
 *   pages: string, isbn10: string, isbn13: string, series: string,
 *   volume: string, categories: string, description: string,
 *   metaDescription: string, md5: string
 * }>}
 */
export async function buildBookPageMetadata (page, defaults = {}) {
  const [title, author, language, formatQualityRating, cardAttrs, detailAttrs] = await Promise.all([
    extractBookTitle(page),
    extractBookAuthor(page),
    extractBookLanguage(page),
    extractBookFormatQualityRating(page),
    extractBookCardAttributes(page),
    extractBookDetailAttributes(page),
  ])
  // Validation-gated language: pick the first candidate that maps to a known language code.
  // This rejects garbage (HTML category text, book titles, etc.) extracted from the DOM.
  const validLanguage = [language, cardAttrs.language, defaults.language]
    .find(v => v && languageCodeByName(v))
  const finalLanguage = validLanguage || ''
  const finalLanguageCode = validLanguage ? languageCodeByName(validLanguage) : ''

  return {
    title: title || defaults.title || '',
    author: normalizeAuthorCredit(author || cardAttrs.author || defaults.author || ''),
    language: finalLanguage,
    languageCode: finalLanguageCode,
    year: cardAttrs.year || '',
    filesize: cardAttrs.filesize || '',
    extension: cardAttrs.extension || defaults.extension || '',
    rating: cardAttrs.rating || '',
    formatQualityRating: (formatQualityRating && formatQualityRating !== '0' && formatQualityRating !== '0.0') ? formatQualityRating : (cardAttrs.quality && cardAttrs.quality !== '0' && cardAttrs.quality !== '0.0') ? cardAttrs.quality : (defaults.formatQualityRating && defaults.formatQualityRating !== '0' && defaults.formatQualityRating !== '0.0') ? defaults.formatQualityRating : 'NA',
    publisher: cardAttrs.publisher || detailAttrs.publisher || defaults.publisher || '',
    isbn: cardAttrs.isbn || detailAttrs.isbn || defaults.isbn || '',
    pages: detailAttrs.pages || '',
    isbn10: detailAttrs.isbn10 || '',
    isbn13: detailAttrs.isbn13 || '',
    series: detailAttrs.series || '',
    volume: detailAttrs.volume || '',
    categories: detailAttrs.categories || '',
    description: detailAttrs.description || '',
    metaDescription: detailAttrs.metaDescription || '',
    md5: cardAttrs.md5 || defaults.md5 || '',
  }
}
