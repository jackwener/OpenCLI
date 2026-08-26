/**
 * @deprecated Re-export barrel for backward compatibility.
 *
 * This file is a migration shim. All own-implementation functions have been
 * moved to `_shared/` modules. Commands SHOULD import directly from
 * `_shared/` subdirectories instead of through this barrel.
 *
 * Scheduled for removal after all commands have migrated.
 * See task: 06-26-zlibrary-app-utils-barrel-elimination
 *
 * Migration phases:
 *   Phase 1 — Function decomposition (DONE): utils.js own functions moved
 *     to _shared/ modules. utils.js is now pure re-export barrel.
 *   Phase 3 — Command import migration: update all commands to bypass utils.js.
 *   Phase 5 — Remove file: delete this barrel.
 */

// ---------------------------------------------------------------------------
// DOM & URL extractors — re-exported from sibling adapters
// ---------------------------------------------------------------------------

import {
  extractSearchResults,
  extractBookTitle,
  extractBookAuthor,
  extractBookLanguage,
  extractBookFormatQualityRating,
  extractBookDetailAttributes,
  extractBookCardAttributes,
  extractFormats,
  EXTS,
  LANGS,
  LANGUAGES,
  CONTENT_TYPES,
  LANGUAGE_BY_CODE,
  fmtBytes,
  validateLanguage,
  validateLanguageName,
  validateExtension,
  validateContentType,
  languageCodeByName,
} from '../zlibrary/dom.js'

import { parseUrl, isHttpUrl } from '../zlibrary/utils.js'

export {
  extractSearchResults,
  extractFormats,
  extractBookTitle,
  extractBookAuthor,
  extractBookLanguage,
  extractBookFormatQualityRating,
  extractBookDetailAttributes,
  extractBookCardAttributes,
  EXTS,
  LANGS,
  CONTENT_TYPES,
  LANGUAGE_BY_CODE,
  LANGUAGES,
  fmtBytes,
  validateLanguage,
  validateLanguageName,
  validateExtension,
  validateContentType,
  languageCodeByName,
  parseUrl,
  isHttpUrl,
}

// ---------------------------------------------------------------------------
// _shared/ module exports
// ---------------------------------------------------------------------------

// book-metadata.js
import { buildBookPageMetadata } from './_shared/book-metadata.js'
export { buildBookPageMetadata }

// md5-format.js → _shared/infra/md5-format.js
import { extractBookMd5, extractMd5FromCdnFilenameParam } from './_shared/infra/md5-format.js'
export { extractBookMd5, extractMd5FromCdnFilenameParam }

// manifest-helpers.js → _shared/infra/manifest-helpers.js
export {
  FILENAME_TEMPLATE_DEFAULT,
  renderFilenameTemplate,
  normalizeOutputKeys,
  saveCompletedManifestEntry,
  saveManifestEntry,
  isCompleted,
  loadManifest,
  getPending,
  computeFileMd5,
  fmtStatusSummary,
  verifyCompleted,
  readFirstBytes,
  findVerifiedCompletedByBookId,
  sanitiseFilename,
  sanitiseBookId,
  formatDownloadFilename,
  hasCanonicalDownloadForBookId,
} from './_shared/infra/manifest-helpers.js'

// download-contracts.js → _shared/download/contracts.js
export {
  sniffMimeType,
  isLikelyHtmlPrefix,
  detectDownloadedContentKind,
  detectHtmlBlockContent,
} from './_shared/download/contracts.js'
