/**
 * Booklist Mutation Workflow for Z-Library Desktop.
 *
 * Consolidates the collect → dedup → add → count loop that is
 * repeated across booklist-create.js, booklist-add.js, and
 * booklist-manage.js.
 *
 * @module booklist-mutation
 */

import { addBookToBooklist } from '../booklist/api.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Batch-add books to a booklist with optional dedup.
 *
 * Iterates over the book array, skipping missing IDs and (when dedupe
 * is enabled) books already present in the target list.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} booklistId - Target booklist ID
 * @param {Array<{id: string|number}>} books - Books to add (each must have an `id` field)
 * @param {object} [options]
 * @param {Set<string>|null} [options.existingBookIds=null] - Set of book IDs already in the list
 * @param {boolean} [options.dedupe=true] - Whether to skip duplicates
 * @param {Function|null} [options.onProgress] - Progress callback(added, skipped, total, bookId)
 * @param {import('../fixture/index.js').ApiCallRecorder} [options.recorder] - Fixture recorder
 * @returns {Promise<{ added: number, skipped: number, total: number, lastBookId: string }>}
 */
export async function addBooksToBooklist(page, booklistId, books, options = {}) {
  const existingBookIds = options.existingBookIds != null ? options.existingBookIds : null
  const dedupe = options.dedupe !== false
  const onProgress = options.onProgress || null
  const collectRows = options.collectRows === true

  let added = 0
  let skipped = 0
  let lastBookId = ''
  const rows = []

  for (let j = 0; j < books.length; j++) {
    const book = books[j]
    const bookId = String(book.id || '')
    let status = 'added'
    let reason = null
    if (!bookId) {
      skipped++
      status = 'skipped'
      reason = 'empty ID'
      if (collectRows) rows.push({ book, status, reason })
      continue
    }
    if (dedupe && existingBookIds && existingBookIds.has(bookId)) {
      skipped++
      status = 'skipped'
      reason = 'already in list'
      if (collectRows) rows.push({ book, status, reason })
      continue
    }
    const result = await addBookToBooklist(page, booklistId, bookId, { recorder: options.recorder })
    if (isSuccessfulBooklistAdd(result)) {
      added++
      lastBookId = bookId
      status = 'added'
    } else {
      skipped++
      status = 'skipped'
      reason = getBooklistAddSkipReason(result)
    }
    if (collectRows) rows.push({ book, status, reason })
    if (onProgress) {
      onProgress(added, skipped, books.length, bookId)
    }
  }

  return { added, skipped, total: books.length, lastBookId, rows }
}

/**
 * Classify a skip reason from the add-book API result's error text.
 *
 * The add-book endpoint returns application-level errors in HTTP 200
 * responses, e.g. `{ error: 'Book already in list' }`.  These are NOT
 * HTTP/network failures  -  they are the server's way of saying "book
 * not added (already exists)".  Distinguishing them from real API
 * errors lets the `--list` output show accurate skip reasons.
 *
 * @param {object|null|undefined} result - Raw response from addBookToBooklist
 * @returns {string} - Human-readable skip reason label
 */
function getBooklistAddSkipReason(result) {
  var error = null
  if (result && result.error) error = String(result.error).trim()
  if (!error) return 'missing readlistBookId'
  // Known application-level dedup responses from the add-book API
  if (/already|exist|duplicate|readlist|booklist/i.test(error)) {
    return 'already in list'
  }
  return 'API error: ' + error
}

/**
 * Check whether a booklist API add result indicates a successful addition.
 *
 * @param {object|null|undefined} result - Response from addBookToBooklist
 * @returns {boolean}
 */
export function isSuccessfulBooklistAdd(result) {
  return !!(result && (result.readlistBookId != null || result.success === true))
}

export { getBooklistAddSkipReason }

/**
 * Convert a getBookIdList response into a Set of string book IDs for
 * fast O(1) dedup lookups.
 *
 * @param {Array<{bookId: string|number}>} mappings - Book ID list mappings
 * @returns {Set<string>}
 */
export function toExistingBookIdSet(mappings) {
  const set = new Set()
  for (let i = 0; i < mappings.length; i++) {
    set.add(String(mappings[i].bookId))
  }
  return set
}
