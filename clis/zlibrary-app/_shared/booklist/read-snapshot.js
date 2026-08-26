/**
 * Booklist read-flow shared acquisition kernel.
 *
 * Single entry point for all read-only booklist commands (show, export).
 * Returns a stable snapshot of entry metadata + books + page origin.
 *
 * Owns scope-aware read discovery, optional metadata enrichment,
 * DOM book extraction via getBooklistBooks(), and current page origin capture.
 *
 * @module read-snapshot
 */

import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import {
  getBooklists,
  getBooklistInfo,
  getBooklistBooks,
  getBooklistsFromTab,
} from './api.js'
import { getCurrentHttpOrigin } from '../infra/url-boundary.js'

/**
 * Read a booklist snapshot: entry metadata + books + origin.
 *
 * Scope-aware discovery:
 *   - scope=my: API current-user first, DOM fallback on /booklists/my
 *   - scope=public|favorite: DOM search on /booklists/{scope}
 *
 * Metadata enrichment is 404-tolerant (returns {} on API error).
 * Books are extracted via existing getBooklistBooks() DOM extraction.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{name: string, scope?: string, debugCdp?: boolean}} opts
 * @returns {Promise<{
 *   entry: {id: number, title: string, bookCount: number, createdAt: string, scope: string},
 *   books: Array<object>,
 *   origin: string,
 *   warnings: string[]
 * }>}
 * @throws {CommandExecutionError} - If booklist not found
 * @throws {ArgumentError} - If name is empty
 */
export async function readBooklistSnapshot (page, opts = {}) {
  const name = String(opts.name || '').trim()
  if (!name) {
    throw new ArgumentError('readBooklistSnapshot: name cannot be empty')
  }

  const normalizedScope = String(opts.scope || 'my').toLowerCase()
  const debugCdp = opts.debugCdp || false
  const recorder = opts.fixture || null

  // Step 1: Scope-aware discovery (pass recorder through)
  const entry = await resolveBooklistEntry(page, { name, scope: normalizedScope, recorder })

  // Step 2: Optional metadata enrichment (404-tolerant)
  const info = await readOptionalBooklistInfo(page, entry.id, recorder)
  if (info && info.id) {
    // Merge enriched fields into entry, preserving existing values as fallback
    entry.bookCount = info.bookCount ?? entry.bookCount
    entry.createdAt = info.createdAt ?? entry.createdAt
    entry.accessType = info.accessType
  }

  // Step 3: Capture current origin before DOM extraction (fixed evaluate position)
  // Must happen before getBooklistBooks because its internal pagination branch
  // changes the evaluate call count (clickLoadMore is called only when books
  // found are fewer than expectedCount), which would shift the origin capture
  // position and break test mocking.
  const origin = (await getCurrentHttpOrigin(page)).origin

  // Step 4: Extract books via DOM extraction
  const expectedCount = typeof entry.bookCount === 'number' ? entry.bookCount : 0
  const books = await getBooklistBooks(page, entry.id, {
    name,
    expectedCount,
    scope: normalizedScope,
    debugCdp,
  })

  return {
    entry: {
      id: entry.id,
      title: entry.title,
      bookCount: typeof entry.bookCount === 'number' ? entry.bookCount : 0,
      createdAt: entry.createdAt || '',
      scope: normalizedScope,
    },
    books,
    origin,
    warnings: [],
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Scope-aware booklist entry resolver.
 * Dispatches to the correct strategy function based on scope.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{name: string, scope: string}} opts
 * @returns {Promise<{id: number, title: string, bookCount?: number, createdAt?: string}>}
 * @throws {CommandExecutionError}
 */
async function resolveBooklistEntry (page, { name, scope, recorder }) {
  if (scope === 'my') {
    return resolveMyBooklistEntry(page, name, recorder)
  }
  // public or favorite: DOM-only tab search
  return resolveTabBooklistEntry(page, name, scope)
}

/**
 * Resolve a booklist entry for scope=my.
 * Uses API current-user endpoint first, falls back to DOM rescue on /booklists/my.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title (exact match)
 * @returns {Promise<{id: number, title: string, bookCount?: number, createdAt?: string}>}
 * @throws {CommandExecutionError}
 */
async function resolveMyBooklistEntry (page, name, recorder) {
  // Primary: API current-user
  const myLists = await getBooklists(page, undefined, { recorder })
  const match = myLists.find(function (l) { return l.title === name })
  if (match) return match

  // Fallback: DOM search on /booklists/my
  const tabLists = await getBooklistsFromTab(page, 'my')
  const domMatch = tabLists.find(function (l) { return l.topic === name })
  if (!domMatch) throwBooklistNotFound(name, 'my')
  return {
    id: domMatch.id,
    title: domMatch.topic,
    bookCount: domMatch.bookCount || 0,
    createdAt: '',
  }
}

/**
 * Resolve a booklist entry from a scope tab via DOM extraction.
 * Used for public and favorite scopes where no API endpoint exists.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title (exact match)
 * @param {string} scope - 'public' or 'favorite'
 * @returns {Promise<{id: number, title: string, bookCount?: number, createdAt?: string}>}
 * @throws {CommandExecutionError}
 */
async function resolveTabBooklistEntry (page, name, scope) {
  const tabLists = await getBooklistsFromTab(page, scope)
  const domMatch = tabLists.find(function (l) { return l.topic === name })
  if (!domMatch) throwBooklistNotFound(name, scope)
  return {
    id: domMatch.id,
    title: domMatch.topic,
    bookCount: domMatch.bookCount || 0,
    createdAt: '',
  }
}

/**
 * Throw CommandExecutionError for booklist not found.
 * @param {string} name
 * @param {string} scope
 * @throws {CommandExecutionError}
 */
function throwBooklistNotFound (name, scope) {
  throw new CommandExecutionError(
    'Booklist "' + name + '" not found in ' + scope + ' booklists. ' +
    'Use `opencli zlibrary-app booklist-list --scope ' + scope + '` to see available booklists.'
  )
}

/**
 * Enrich entry with API metadata (404-tolerant).
 * Returns {} on 404 or API error so book extraction is not blocked.
 * Does NOT catch CDP/network errors — relies on getBooklistInfo() 404 tolerance.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} id - Booklist ID
 * @returns {Promise<object>}
 */
async function readOptionalBooklistInfo (page, id, recorder) {
  const info = await getBooklistInfo(page, id, { recorder })
  return info || {}
}
