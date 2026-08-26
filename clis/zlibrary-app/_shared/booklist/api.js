/**
 * CDP-based booklist API helpers for Z-Library Desktop.
 *
 * All operations use page.evaluate() to call Z-Library Desktop App's
 * internal REST APIs directly via fetch() in the webview context.
 * This is faster and more reliable than DOM navigation.
 *
 * SECURITY:
 * - All endpoint URLs are built with encodeURIComponent + JSON.stringify
 *   before any page.evaluate() interpolation to prevent script injection.
 * - Endpoint URLs are validated to start with /papi/booklist/ (endpoint
 *   allowlist).
 * - URLs returned from API responses are validated for same-origin + http(s)
 *   inside the evaluate script, before crossing the CDP boundary.
 * - Node.js retains defense-in-depth sanitization.
 * - Navigation URLs are validated via url-boundary helpers to enforce
 *   the URL trust boundary (same-origin + http(s)).
 */
import { parseJsonOrDefault } from '../../../_shared/browser-utils.js'
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors'
import { toSameOriginAbsoluteUrl, getCurrentHttpOrigin, assertSameOriginNotLoginWall } from '../infra/url-boundary.js'

// ---------------------------------------------------------------------------
// Scope constants and helpers
// ---------------------------------------------------------------------------

/**
 * Map of scope values to their corresponding tab URL paths.
 * These are relative paths resolved against the current page origin.
 */
export const SCOPE_TAB_URLS = {
  public: '/booklists',
  favorite: '/booklists/favorite',
  my: '/booklists/my',
}

/**
 * DOM attribute name that holds a book's membership id within a booklist.
 * Read from `z-bookcard` elements on the booklist detail page. This is the
 * value required by the remove-book API (`/remove-book/{readlistBookId}`).
 * The `/papi/booklist/book-id-list` API never returns it (verified 2026-08-08,
 * 3888 mappings were all `{bookId, booklistId}` only).
 */
export const BOOKLIST_MEMBERSHIP_ID_ATTRIBUTE = 'booklistsindex'

/**
 * Maximum load-more clicks for booklist DOM pagination.
 * Shared by getBooklistBooks() extraction and resolveReadlistBookIdFromDom()
 * so large booklists (400+ books) are never truncated differently by the two
 * consumers of the same DOM pagination.
 */
export const MAX_BOOKLIST_LOAD_MORE_CLICKS = 200

/**
 * Get the tab URL path for a given scope.
 *
 * @param {string} scope - Scope value: 'public', 'favorite', or 'my'
 * @returns {string} - Relative URL path for the scope tab
 * @throws {ArgumentError} - If scope is not a valid value
 */
export function getScopeTabUrl (scope) {
  const normalized = String(scope || 'my').toLowerCase()
  const url = SCOPE_TAB_URLS[normalized]
  if (!url) {
    throw new ArgumentError(
      'Invalid scope: ' + scope,
      'Valid scopes: public, favorite, my'
    )
  }
  return url
}

/**
 * Get booklists from a scope tab page via DOM extraction.
 * Used for 'public' and 'favorite' scopes where API doesn't expose them.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} scope - Scope value: 'public', 'favorite', or 'my'
 * @returns {Promise<Array<{topic: string, href: string, bookCount?: number, id?: number}>>}
 */
export async function getBooklistsFromTab (page, scope) {
  const tabPath = getScopeTabUrl(scope)
  const originUrl = await getCurrentHttpOrigin(page)
  const tabUrl = originUrl.origin + tabPath

  await page.goto(tabUrl, { waitUntil: 'load', settleMs: 3000 })
  await assertSameOriginNotLoginWall(page, originUrl, 'booklist-api')

  const raw = await page.evaluate(`
    (function() {
      function searchShadow(root) {
        if (!root || !root.querySelectorAll) return [];
        var lists = Array.from(root.querySelectorAll('z-booklist'));
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) {
            lists = lists.concat(searchShadow(all[i].shadowRoot));
          }
        }
        return lists;
      }
      var lists = searchShadow(document);
      var rows = [];
      for (var i = 0; i < lists.length; i++) {
        var el = lists[i];
        var href = (el.getAttribute('href') || '').trim();
        var topic = (el.getAttribute('topic') || '').trim();
        var bookCount = el.getAttribute('bookcount') || el.getAttribute('book-count') || '';
        var id = undefined;
        var match = href.match(/\\/booklist\\/(\\d+)\\//);
        if (match) id = parseInt(match[1], 10);
        rows.push({
          topic: topic,
          href: href,
          bookCount: bookCount ? parseInt(bookCount, 10) : undefined,
          id: id
        });
      }
      return JSON.stringify(rows);
    })()
  `)

  return parseJsonOrDefault(raw, [])
}

// ---------------------------------------------------------------------------
// Central CDP API caller
// ---------------------------------------------------------------------------

/**
 * Execute a fetch() call in the browser context and return parsed JSON.
 *
 * Builds the endpoint URL safely using JSON.stringify() for interpolation.
 * Handles HTTP errors, JSON parse failures, and network errors.
 * POST requests use `new Request()` to avoid Content-Type header (Z-Library quirk).
 *
 * The endpoint MUST start with /papi/booklist/  -  enforced by endpoint allowlist.
 *
 * By default, throws CommandExecutionError when the API returns an error
 * (HTTP failure or network error).  Use `{ allowError: true }` for optional
 * writes that should degrade gracefully instead of crashing the command.
 *
 * @template T
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} endpoint - Full or relative URL to fetch
 * @param {{ method?: string, body?: string, fallback?: T, allowError?: boolean }} [options]
 * @returns {Promise<T>}
 * @throws {CommandExecutionError}
 */
export async function requestBooklistApi (page, endpoint, options = {}) {
  // -- Endpoint allowlist ---------------------------------------------
  // Only allow /papi/booklist/* endpoints (oracle finding)
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/papi/booklist/')) {
    throw new ArgumentError(
      'requestBooklistApi: endpoint must start with /papi/booklist/',
      'Got: ' + String(endpoint).slice(0, 100)
    )
  }

  const safeEndpoint = JSON.stringify(endpoint)
  const safeMethod = JSON.stringify(options.method || 'GET')

  // POST must use `new Request()` to avoid Content-Type header (Z-Library quirk);
  // GET uses plain fetch. Both share the same error/JSON handling.
  let fetchStatement
  if (options.method === 'POST') {
    const safeBody = JSON.stringify(options.body || '')
    fetchStatement = `
            const r = new Request(${safeEndpoint}, { method: ${safeMethod}, body: ${safeBody} });
            const resp = await fetch(r, { credentials: 'include' });`
  } else {
    fetchStatement = `
            const resp = await fetch(${safeEndpoint}, { credentials: 'include', method: ${safeMethod} });`
  }

  const fetchBody = `
        try {${fetchStatement}
            const text = await resp.text();
            if (!resp.ok) return JSON.stringify({ error: 'HTTP ' + resp.status + ': ' + resp.statusText, _httpStatus: resp.status });
            const parsed = JSON.parse(text);
            return JSON.stringify(parsed);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    `

  const raw = await page.evaluate('(async () => { ' + fetchBody + ' })()')
  const data = parseJsonOrDefault(raw, options.fallback)

  // Record API call for fixture (before error throw so failures captured)
  if (options.recorder) {
    const recordOptions = {
      endpoint: endpoint,
      method: options.method || 'GET',
      requestBody: options.body || null,
      httpStatus: data && data._httpStatus ? data._httpStatus : 200,
      responseBody: data,
    }
    options.recorder.record(recordOptions)
  }

  // Throw on API errors unless explicitly opted out (oracle finding #6)
  // A non-null `error` field in the response indicates HTTP failure or
  // network error from the CDP wrapper  -  not an application-level response.
  if (data && data.error && !options.allowError) {
    throw new CommandExecutionError(
      'Z-Library Desktop API request failed' +
        (data._httpStatus ? ' (HTTP ' + data._httpStatus + ')' : '') +
        ': ' + data.error
    )
  }

  return data
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Get all booklists for the current user.
 * GET /papi/booklist/current-user/
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} [scope] - Optional scope: 'my' (default, uses API), 'public', 'favorite' (uses DOM extraction)
 * @returns {Promise<Array<{id: number, title: string, description: string, bookCount: number, createdAt: string}>>}
 */
export async function getBooklists (page, scope, options = {}) {
  // If scope is provided and not 'my', use DOM extraction from the scope tab
  if (scope && scope !== 'my') {
    const tabLists = await getBooklistsFromTab(page, scope)
    // Transform DOM shape to match API shape for backward compatibility
    return tabLists.map(function (l) {
      return {
        id: l.id || 0,
        title: l.topic,
        description: '',
        bookCount: l.bookCount || 0,
        createdAt: '',
      }
    })
  }

  // Default: API path for 'my' scope (backward compatible)
  const data = await requestBooklistApi(page, '/papi/booklist/current-user/', { fallback: [], recorder: options.recorder })
  // Handle both raw array and {list: [...]} response shapes
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.list)) return data.list
  return []
}

/**
 * Look up a booklist ID by its title from the current user's booklists.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title (exact match)
 * @returns {Promise<number|null>}
 */
export async function getBooklistIdByName (page, name, options = {}) {
  const lists = await getBooklists(page, undefined, { recorder: options.recorder })
  const match = lists.find(function (l) { return l.title === name })
  return match ? match.id : null
}

/**
 * Resolve a booklist name to its full entry, throwing CommandExecutionError if not found.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title (exact match)
 * @param {Array} [availableBooklists] - Pre-fetched booklist array (avoids extra API call)
 * @returns {Promise<{id: number, title: string}>}
 * @throws {CommandExecutionError}
 */
export async function resolveBooklistByNameOrThrow (page, name, availableBooklists, options = {}) {
  const lists = availableBooklists || (await getBooklists(page, undefined, { recorder: options.recorder }))
  const match = lists.find(function (l) { return l.title === name })
  if (!match) {
    throw new CommandExecutionError(
      'Booklist "' + name + '" not found. ' +
            'Use `opencli zlibrary-app booklist-list` to see available booklists.'
    )
  }
  return match
}

/**
 * Create a new booklist.
 * POST /papi/booklist/create
 * IMPORTANT: Must NOT set Content-Type: application/json  -  use new Request().
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title
 * @param {string} [description] - Optional description
 * @returns {Promise<{id?: number, title?: string, description?: string, success?: boolean, error?: string, [key: string]: *}>}
 */
export async function createBooklist (page, name, description, options = {}) {
  const data = await requestBooklistApi(page, '/papi/booklist/create', {
    method: 'POST',
    body: JSON.stringify({ title: name, description: description || '' }),
    fallback: { success: false },
    allowError: true,
    recorder: options.recorder,
  })

  // Normalize create response shape.
  // Real API returns: { success: 1, readlist: { id: "...", title: "...", ... } }
  // Command expects id/title at root-level for compatibility.
  if (data && !data.error && data.readlist && data.readlist.id) {
    return {
      id: Number(data.readlist.id),
      title: data.readlist.title,
      description: data.readlist.description,
      success: true
    }
  }

  return data
}

/**
 * Get booklist-to-book mappings for a specific booklist (or all).
 * GET /papi/booklist/book-id-list
 *
 * REAL response shape (verified 2026-08-08, 3888 mappings): every mapping is
 * `{bookId, booklistId}` only. The API NEVER returns readlistBookId — the
 * membership id must be resolved from the DOM (z-bookcard booklistsindex).
 * Also, the `booklistId` query parameter is ignored server-side: the response
 * contains mappings across ALL booklists.
 *
 * URLs in the response are validated for same-origin + http(s) inside the
 * evaluate script before crossing the CDP boundary.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} [booklistId] - Optional booklist ID (NOTE: ignored server-side)
 * @returns {Promise<Array<{bookId: number, booklistId: number, title: string, author: string}>>}
 */
export async function getBookIdList (page, booklistId, options = {}) {
  let endpoint = '/papi/booklist/book-id-list'
  if (booklistId != null) {
    endpoint += '?booklistId=' + encodeURIComponent(booklistId)
  }
  const safeEndpoint = JSON.stringify(endpoint)

  // Use a custom evaluate script that also sanitizes URLs inside the browser
  // context  -  prevents raw URLs from crossing the CDP boundary unvalidated.
  const raw = await page.evaluate('(async () => { ' + `
    try {
      const resp = await fetch(${safeEndpoint}, { credentials: 'include' });
      const text = await resp.text();
      if (!resp.ok) return JSON.stringify({ error: 'HTTP ' + resp.status + ': ' + resp.statusText, _httpStatus: resp.status });
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { return JSON.stringify({ error: e.message }); }

      // Normalise response: accept raw array, {results: [...]}, or {list: [...]}
      var items = Array.isArray(parsed) ? parsed : (parsed.results || parsed.list || []);

      // Sanitize URLs: validate same-origin + http(s) for each item's url field
      var origin = window.location.origin;
      items = items.map(function(item) {
        if (item.url) {
          try {
            var u = new URL(item.url, origin);
            if (u.origin !== origin || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
              item.url = '';
            } else {
              item.url = u.href;
            }
          } catch(e) {
            item.url = '';
          }
        }
        return item;
      });

      return JSON.stringify(items);
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  ` + ' })()')

  const data = parseJsonOrDefault(raw, [])

  // Record API call for fixture
  if (options.recorder) {
    const httpStatus = data && data._httpStatus ? data._httpStatus : 200
    options.recorder.record({
      endpoint: endpoint,
      method: 'GET',
      requestBody: null,
      httpStatus: httpStatus,
      responseBody: data,
    })
  }

  // Handle error responses
  if (data && data.error) {
    throw new CommandExecutionError(
      'Z-Library Desktop API request failed: ' + data.error
    )
  }

  // Defense-in-depth: URLs are sanitized inside the evaluate script before
  // crossing the CDP boundary (same-origin + http(s) check). A Node.js-side
  // re-check would require the page origin, which this function doesn't
  // receive  -  so evaluate-side sanitization is the primary boundary.
  return data
}

/**
 * Add a book to a booklist.
 * GET /papi/booklist/{id}/add-book/{bookId}
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} booklistId
 * @param {string|number} bookId
 * @returns {Promise<{readlistBookId?: number, success?: boolean, error?: string}>}
 */
export async function addBookToBooklist (page, booklistId, bookId, options = {}) {
  const endpoint = '/papi/booklist/' + encodeURIComponent(booklistId) + '/add-book/' + encodeURIComponent(bookId)
  const data = await requestBooklistApi(page, endpoint, { fallback: {}, allowError: true, recorder: options.recorder })

  // Normalize add-book response shape.
  // Real API returns: { success: 1, book: { id: "...", book_id: ... } }
  // Command/mutation layer expects readlistBookId + boolean success at root.
  if (data && !data.error && data.success === 1 && data.book && data.book.id != null) {
    return {
      success: true,
      readlistBookId: Number(data.book.id),
      bookId: Number(data.book.book_id)
    }
  }

  return data
}

/**
 * Delete a booklist.
 * GET /papi/booklist/{id}/delete
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} id
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
export async function deleteBooklist (page, id, options = {}) {
  const endpoint = '/papi/booklist/' + encodeURIComponent(id) + '/delete'
  return requestBooklistApi(page, endpoint, { fallback: { success: false }, allowError: true, recorder: options.recorder })
}

/**
 * Remove a book from a booklist.
 * GET /papi/booklist/{id}/remove-book/{readlistBookId}
 *
 * Real API returns: { success: 1 }
 * Normalized to:    { success: true }
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} booklistId
 * @param {string|number} readlistBookId - From book-id-list response (NOT bookId)
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
export async function removeBookFromBooklist (page, booklistId, readlistBookId, options = {}) {
  const endpoint = '/papi/booklist/' + encodeURIComponent(booklistId) + '/remove-book/' + encodeURIComponent(readlistBookId)
  const data = await requestBooklistApi(page, endpoint, { fallback: { success: false }, allowError: true, recorder: options.recorder })

  // Normalize response: real API returns { success: 1 } (integer)
  // Convert to { success: true } for consistent boolean checks
  if (data && !data.error && data.success === 1) {
    return { ...data, success: true }
  }

  return data
}

/**
 * Get booklist metadata by ID.
 * GET /papi/booklist/{id}
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} id
 * @returns {Promise<{id?: number, title?: string, description?: string, accessType?: string, bookCount?: number, createdAt?: string, error?: string}>}
 */
export async function getBooklistInfo (page, id, options = {}) {
  const endpoint = '/papi/booklist/' + encodeURIComponent(id)
  const data = await requestBooklistApi(page, endpoint, { fallback: {}, allowError: true, recorder: options.recorder })
  if (!data || data.error) return {}
  return data
}

/**
 * Get all books in a booklist with full details including slug URLs.
 *
 * Instead of guessing API endpoint patterns (which all return 404), this
 * function uses the PUBLIC web UI:
 *
 *   1. Search `/booklists/{scope}?searchQuery={name}`  -  renders <z-booklist>
 *      as light DOM with a real `href` attribute
 *   2. Extract the matching `<z-booklist href="/booklist/{id}/{hash}/{slug}.html">`
 *       -  this is the real booklist detail page URL
 *   3. Navigate to the detail page via page.goto
 *   4. Extract all `<a href="/book/{slug}/...">` URLs (light DOM anchor tags)
 *   5. Click "load more" / "show more" if present to reach `expectedCount`
 *
 * All returned URLs are absolute same-origin http(s) URLs validated inside
 * the browser context before crossing the CDP boundary.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} booklistId - Booklist ID; used as identity guard when the
 *   detail href is resolved (only /booklist/{booklistId}/ hrefs are accepted)
 * @param {object} [opts]
 * @param {string} opts.name - booklist title to search for (REQUIRED)
 * @param {number} [opts.expectedCount] - expected book count from API, used as load-more stop condition
 * @param {boolean} [opts.debugCdp] - emit debug stderr lines
 * @param {string} [opts.scope] - booklist scope: 'public', 'favorite', 'my' (default: 'my')
 * @returns {Promise<Array<{readlistBookId: string, bookId: string, title: string, author: string, language: string, extension: string, size: string, url: string}>>}
 */
export async function getBooklistBooks (page, booklistId, opts = {}) {
  const name = opts.name || ''
  const debugCdp = opts.debugCdp || false
  const scope = opts.scope || 'my'

  // expectedCount: use API-provided count first, fall back to 0.
  // 0 disables early stop (load-more runs until no more books).
  let expectedCount = typeof opts.expectedCount === 'number' ? opts.expectedCount : 0

  if (!name) {
    throw new CommandExecutionError(
      'getBooklistBooks requires opts.name to search for the booklist on ' + getScopeTabUrl(scope)
    )
  }

  // Get and validate current page origin (URL trust boundary)
  const originUrl = await getCurrentHttpOrigin(page)
  const origin = originUrl.origin

  // -- Step 1: Search for the booklist on the scope tab ----------------
  // findBooklistDetailHref handles: navigate search URL + 3-attempt z-booklist extraction
  const navigateSearchStartedAt = Date.now()
  if (debugCdp) {
    process.stderr.write('[booklist-api] searching for "' + name + '" on scope "' + scope + '"\n')
  }

  const detailHref = await findBooklistDetailHref(page, origin, name, scope, booklistId)

  console.warn('[booklist-api]', JSON.stringify({ phase: 'navigate_search', elapsedMs: Date.now() - navigateSearchStartedAt, found: !!detailHref }))

  // Verify search navigation didn't redirect to login wall or different origin
  await assertSameOriginNotLoginWall(page, originUrl, 'booklist-api')

  if (!detailHref) {
    throw new CommandExecutionError(
      'Z-Library Desktop: booklist "' + name + '" not found on ' + getScopeTabUrl(scope) + '. ' +
      'Search returned 0 matching booklists after 3 attempts. Try --debug-cdp for more details.'
    )
  }

  // Validate detail URL against URL trust boundary (same-origin + http(s))
  const detailUrl = toSameOriginAbsoluteUrl(detailHref, origin)
  if (!detailUrl) {
    throw new CommandExecutionError(
      'Z-Library Desktop: booklist detail URL failed same-origin/http(s) validation.',
      'Got: ' + detailHref + ', expected origin: ' + origin
    )
  }
  if (debugCdp) {
    process.stderr.write('[booklist-api] found detail URL: ' + detailUrl + '\n')
  }

  // -- Step 3: Navigate to the booklist detail page --------------------
  // settleMs: 3000 gives custom elements time to upgrade after DOM load.
  const navigateDetailStartedAt = Date.now()
  console.warn('[booklist-api]', JSON.stringify({ phase: 'navigate_detail_start', elapsedMs: 0, url: detailUrl }))
  await page.goto(detailUrl, { waitUntil: 'load', settleMs: 3000 })
  console.warn('[booklist-api]', JSON.stringify({ phase: 'navigate_detail', elapsedMs: Date.now() - navigateDetailStartedAt, url: detailUrl }))

  // Verify we didn't get redirected to a different origin or login wall
  await assertSameOriginNotLoginWall(page, originUrl, 'booklist-api')

  // -- Step 3.5: Wait until the real extraction path sees rendered rows ------
  // Use the same predicate as extraction. Do not probe z-bookcard[id]:
  // bookcard DOM id is not the extraction contract.
  let books = []
  let readyRetries = 0
  const READY_STARTED_AT = Date.now()
  const READY_MAX_RETRIES = 20 // 20 x 500ms = 10s max
  const readyTimeoutMs = expectedCount > 0 ? (READY_MAX_RETRIES * 500) : 0

  do {
    books = await extractBooklistBookRows(page, origin, expectedCount)
    if (books.length > 0) break
    readyRetries++
    if (readyRetries >= READY_MAX_RETRIES) break
    if (readyTimeoutMs > 0 && (Date.now() - READY_STARTED_AT) >= readyTimeoutMs) break
    await sleepPromise(500)
  } while (true)

  console.warn('[booklist-api]', JSON.stringify({
    phase: 'booklist_extract_ready',
    elapsedMs: Date.now() - READY_STARTED_AT,
    retries: readyRetries,
    found: books.length > 0,
    count: books.length,
    expectedCount,
  }))

  if (debugCdp) {
    process.stderr.write('[booklist-api] extraction readiness: count=' + books.length + ' after ~' + (Date.now() - READY_STARTED_AT) + 'ms\n')
  }

  // -- Step 4: Extract book rows  -  initial + load-more / scroll loop --
  // books already populated above — move to pagination check

  // If we already have all books, skip pagination
  if (expectedCount > 0 && books.length >= expectedCount) {
    if (debugCdp) {
      process.stderr.write('[booklist-api] extracted all ' + books.length + ' books in initial load\n')
    }
    return books
  }

  // Pagination: click "Show more" / "Load more" button then poll for new
  // bookcards.  The Z-Library booklist detail page renders 20 books
  // initially, then loads the rest in batches via an onclick handler.
  // Uses the known `div.page-load-more` selector which the user confirmed.
  //
  // When expectedCount > 0, pagination runs until books.length >= expectedCount
  // or no more load-more button exists. When expectedCount === 0 (exhaustive
  // mode), pagination runs until no more load-more button, with a safety cap
  // of MAX_BOOKLIST_LOAD_MORE_CLICKS to prevent infinite loops on broken pages.
  let prevCount = books.length
  let ranOutOfLoadMore = false

  for (let pageCycle = 0; pageCycle < MAX_BOOKLIST_LOAD_MORE_CLICKS; pageCycle++) {
    if (expectedCount > 0 && books.length >= expectedCount) break

    const clicked = await clickBooklistLoadMore(page)
    if (!clicked) {
      ranOutOfLoadMore = true
      if (debugCdp) {
        process.stderr.write('[booklist-api] no load-more button found after ' + books.length + ' books\n')
      }
      break
    }

    // Poll for new bookcards to appear (up to 10s) — shared wait semantics.
    const snapshot = await waitForLoadMoreProgress(page, async () => {
      const rows = await extractBooklistBookRows(page, origin, expectedCount)
      return { found: null, count: rows.length, rows }
    }, prevCount)

    if (snapshot.count <= prevCount) {
      if (debugCdp) {
        process.stderr.write('[booklist-api] click ' + (pageCycle + 1) + ' added no new books\n')
      }
      break
    }
    books = Array.isArray(snapshot.rows) ? [...snapshot.rows] : []; prevCount = snapshot.count
    console.warn('[booklist-api]', JSON.stringify({
      phase: 'load_more_count',
      elapsedMs: 0,
      cycle: pageCycle + 1,
      count: books.length,
      expectedCount,
      expectedKnown: (expectedCount || 0) > 0,
    }))

    if (debugCdp) {
      process.stderr.write('[booklist-api] click ' + (pageCycle + 1) + ': ' + books.length + ' books\n')
    }
  }

  // When expectedCount is known but pagination ended early, warn of possible
  // incomplete extraction (e.g. DOM changed, dynamic load failure).
  if (expectedCount > 0 && books.length < expectedCount && ranOutOfLoadMore) {
    console.warn('[booklist-api]', JSON.stringify({
      phase: 'pagination_incomplete',
      expectedCount: expectedCount,
      actualCount: books.length,
      message: 'Booklist may be incomplete. Expected ' + expectedCount + ' books, got ' + books.length + '.',
    }))
  }

  if (debugCdp) {
    process.stderr.write('[booklist-api] extracted ' + books.length + '/' + (expectedCount || '?') + ' books\n')
  }

  return books
}

/**
 * Resolve the detail page URL (relative path) for a booklist by searching
 * the scope tab.
 *
 * Uses the shared findBooklistDetailHref() helper — same search + extraction
 * as getBooklistBooks() but stops after href extraction (no book rows).
 * Returns the relative href path (e.g. /booklist/123/hash/slug.html) so
 * callers can prepend the page origin, respecting the URL security boundary
 * (internal = relative URLs).
 *
 * Returns null on any failure so callers can fall back gracefully.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} name - Booklist title to search for
 * @param {object} [opts]
 * @param {string} [opts.scope] - Booklist scope: 'public', 'favorite', 'my' (default: 'my')
 * @param {string|number} [opts.expectedBooklistId] - Non-destructive identity
 *   guard: when set, only accept hrefs whose /booklist/{id}/ segment equals
 *   this value (see findBooklistDetailHref). Optional — existing callers that
 *   omit it keep first-name-match behavior.
 * @returns {Promise<string|null>} Relative detail path (e.g. /booklist/123/abc/slug.html) or null
 */
export async function resolveBooklistDetailUrl (page, name, opts = {}) {
  const scope = opts.scope || 'my'
  const expectedBooklistId = opts.expectedBooklistId == null ? null : opts.expectedBooklistId
  if (!name) return null

  let originUrl
  try {
    originUrl = await getCurrentHttpOrigin(page)
  } catch (_e) {
    return null
  }

  const detailHref = await findBooklistDetailHref(page, originUrl.origin, name, scope, expectedBooklistId)
  return detailHref || null
}

/**
 * Resolve a book's readlistBookId from the booklist detail page DOM.
 *
 * The `/papi/booklist/book-id-list` API does NOT return readlistBookId
 * (it returns only {bookId, booklistId} mappings). The readlistBookId
 * exists only as the `booklistsindex` attribute on `z-bookcard` elements
 * in the booklist detail page DOM. This helper navigates to the detail
 * page and reads that attribute.
 *
 * Fail-closed contract:
 * - The detail href is accepted ONLY when its /booklist/{booklistId}/ path
 *   segment matches the given booklistId. A same-named different/older
 *   booklist must never be used to resolve the membership id.
 * - Only "book genuinely absent from a verified detail page" returns null.
 *   Invalid Electron targets (empty/non-http origin) propagate
 *   CommandExecutionError instead of being misreported as not-found.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string|number} bookId - The Z-Library book ID to find
 * @param {number} booklistId - The booklist ID (used to verify the detail page)
 * @param {object} [opts]
 * @param {string} opts.name - Booklist title (REQUIRED — used to locate detail page)
 * @param {string} [opts.scope='my'] - Booklist scope: 'public', 'favorite', 'my'
 * @returns {Promise<string|null>} readlistBookId string or null if not found
 * @throws {CommandExecutionError} If connected page origin is invalid
 */
export async function resolveReadlistBookIdFromDom (page, bookId, booklistId, opts = {}) {
  const name = opts.name || ''
  const scope = opts.scope || 'my'

  if (!name) return null

  // Get and validate current page origin (URL trust boundary).
  // Errors propagate: the command must report the real cause (invalid
  // Electron target, loading screen, non-http origin), not a false
  // book_not_found_in_booklist.
  const originUrl = await getCurrentHttpOrigin(page)
  const origin = originUrl.origin

  // Find the booklist detail page href via search. Fail closed: the href must
  // belong to THIS booklist id (exact /booklist/{booklistId}/ path segment).
  const detailHref = await findBooklistDetailHref(page, origin, name, scope, booklistId)

  // The search navigation also crosses the URL trust boundary. Do not trust
  // DOM-derived hrefs from a page that redirected to another origin or login.
  await assertSameOriginNotLoginWall(page, originUrl, 'booklist-api')

  if (!detailHref) return null

  // Validate detail URL against URL trust boundary (same-origin + http(s))
  const detailUrl = toSameOriginAbsoluteUrl(detailHref, origin)
  if (!detailUrl) return null

  // Navigate to detail page
  await page.goto(detailUrl, { waitUntil: 'load', settleMs: 3000 })
  await assertSameOriginNotLoginWall(page, originUrl, 'booklist-api')

  // Scan z-bookcard elements for matching bookId, read booklistsindex attribute
  const targetBookId = String(bookId)
  const scanResult = await scanBooklistDetailForReadlistBookId(page, targetBookId)
  if (scanResult.readlistBookId != null) return scanResult.readlistBookId

  // Not found on initial load — try load-more pagination (shared cap).
  // After each click, poll until the target appears, the rendered card count
  // grows (next page loaded), or 10s elapse — the SAME wait semantics as
  // getBooklistBooks(). A slow webview must not cause a false not-found.
  let prevCardCount = scanResult.cardCount
  for (let idxLoadMore = 0; idxLoadMore < MAX_BOOKLIST_LOAD_MORE_CLICKS; idxLoadMore++) {
    const clicked = await clickBooklistLoadMore(page)
    if (!clicked) break

    const snapshot = await waitForLoadMoreProgress(page, async () => {
      const scan = await scanBooklistDetailForReadlistBookId(page, targetBookId)
      return { found: scan.readlistBookId, count: scan.cardCount }
    }, prevCardCount)

    if (snapshot.found != null) return snapshot.found
    if (snapshot.count <= prevCardCount) break // no DOM progress — stop
    prevCardCount = snapshot.count
  }

  return null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to scope tab search and find the matching booklist detail href.
 *
 * Lightweight helper that extracts the search + extraction pattern shared
 * by getBooklistBooks() and resolveBooklistDetailUrl().
 *
 * 1. Navigate to `/booklists/{scope}?searchQuery={name}`
 * 2. Find `<z-booklist href>` element whose topic attribute matches (3-attempt retry)
 * 3. Return the href attribute value (relative path) or null
 *
 * When `expectedBooklistId` is provided, the href is accepted ONLY if its
 * path contains the exact `/booklist/{expectedBooklistId}/` segment. This
 * fail-closed guard prevents resolving the detail page of a same-named
 * different/older booklist (mutation path requirement).
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} origin - Validated page origin (http(s))
 * @param {string} name - Booklist title to search for
 * @param {string} scope - 'public', 'favorite', or 'my'
 * @param {string|number|null} [expectedBooklistId] - If set, only accept hrefs
 *   whose /booklist/{id}/ segment equals this value
 * @returns {Promise<string|null>} Relative detail href or null
 * @private
 */
async function findBooklistDetailHref (page, origin, name, scope, expectedBooklistId) {
  const searchUrl = origin + getScopeTabUrl(scope) + '?searchQuery=' + encodeURIComponent(name)
  await page.goto(searchUrl, { waitUntil: 'load', settleMs: 3000 })

  // Extract matching booklist href (3-attempt retry)
  let detailHref = ''
  const topic = name.toLowerCase()
  const expectedId = expectedBooklistId == null ? null : String(expectedBooklistId)
  for (let attempt = 0; attempt < 3 && !detailHref; attempt++) {
    if (attempt > 0) await sleepPromise(2000)

    /* eslint-disable-next-line no-loop-func */
    detailHref = await page.evaluate(`
      (function() {
        var topic = ${JSON.stringify(topic)};
        var expectedId = ${expectedId === null ? 'null' : JSON.stringify(expectedId)};
        function matchesBooklist(l) {
          var t = (l.getAttribute('topic') || '').toLowerCase();
          if (t !== topic) return false;
          if (expectedId === null) return true;
          try {
            var u = new URL(l.getAttribute('href') || '', window.location.origin);
            var segs = u.pathname.split('/');
            return segs.length >= 3 && segs[1] === 'booklist' && segs[2] === expectedId;
          } catch (e) { return false; }
        }
        function hrefOf(l) { return l.getAttribute('href') || ''; }
        var lists = document.querySelectorAll('z-booklist');
        for (var i = 0; i < lists.length; i++) {
          if (matchesBooklist(lists[i])) return hrefOf(lists[i]);
        }
        // Fallback: scan open shadow roots for z-booklist
        function searchShadow(root) {
          if (!root || !root.querySelectorAll) return null;
          var list = root.querySelectorAll('z-booklist');
          for (var i = 0; i < list.length; i++) {
            if (matchesBooklist(list[i])) return hrefOf(list[i]);
          }
          var all = root.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
              var found = searchShadow(all[i].shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }
        return searchShadow(document) || '';
      })()
    `)
  }

  return detailHref || null
}

/**
 * Scan the current booklist detail page DOM for a z-bookcard matching bookId.
 * Returns the resolved membership id plus the rendered card count.
 *
 * Matches by `id === bookId` (primary) or exact path-segment match on the
 * href (fallback). Substring matching is forbidden: target '100' must NOT
 * match href '/1000/...' (prefix collision). Fail closed: a matched card
 * without a numeric `booklistsindex` yields readlistBookId null — never
 * mutate without it. Recursively scans open shadow roots.
 *
 * `cardCount` powers the shared load-more progress wait (waitForLoadMoreProgress):
 * a count that grows after a click means the next page rendered.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} bookId - The book ID to match
 * @returns {Promise<{readlistBookId: string|null, cardCount: number}>}
 * @private
 */
async function scanBooklistDetailForReadlistBookId (page, bookId) {
  const raw = await page.evaluate('(function() {' + `
    var targetId = ${JSON.stringify(bookId)};
    var attrName = ${JSON.stringify(BOOKLIST_MEMBERSHIP_ID_ATTRIBUTE)};
    // Exact path-segment match only: '/100' must NOT match '/1000/...'.
    function exactBookIdMatch(cardHref, targetId) {
      try {
        var u = new URL(cardHref, window.location.origin);
        var segs = u.pathname.split('/');
        return segs.indexOf(targetId) !== -1;
      } catch (e) { return false; }
    }
    function scanFrom(root, state) {
      if (!root || !root.querySelectorAll) return state;
      var cards = root.querySelectorAll('z-bookcard');
      state.count += cards.length;
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var cardId = card.getAttribute('id') || '';
        var cardHref = card.getAttribute('href') || '';
        if (cardId === targetId || exactBookIdMatch(cardHref, targetId)) {
          var readlistBookIdAttribute = card.getAttribute(attrName);
          // Fail closed: membership id must be a numeric string, else we
          // cannot construct a safe remove-book URL — never mutate.
          if (readlistBookIdAttribute !== null && /^\\d+$/.test(readlistBookIdAttribute)) {
            state.value = readlistBookIdAttribute;
            return state;
          }
          return state;
        }
      }
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) scanFrom(all[i].shadowRoot, state);
      }
      return state;
    }
    var state = { value: null, count: 0 };
    scanFrom(document, state);
    return JSON.stringify({ readlistBookId: state.value, cardCount: state.count });
  ` + '})()')

  return parseJsonOrDefault(raw, { readlistBookId: null, cardCount: 0 })
}

/**
 * Extract book rows from the current booklist detail page's DOM.
 *
 * Looks for `<z-bookcard href="/book/{slug}/...">` custom elements (primary,
 * used on detail pages).  Falls back to `<a href="/book/{slug}/...">` anchors
 * (search-result pages).  Recursively scans open shadow roots.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} origin
 * @param {number} expectedCount
 * @returns {Promise<Array<object>>}
 */
async function extractBooklistBookRows (page, origin, expectedCount) {
  const raw = await page.evaluate('(function() {' + `
    var maxExpected = ${expectedCount || 99999};
    var seen = {};
    var rows = [];

    function findEnclosingBookcard(el) {
      var current = el;
      while (current) {
        if (current.tagName && String(current.tagName).toLowerCase() === 'z-bookcard') {
          return current;
        }
        if (typeof current.closest === 'function') {
          var closest = current.closest('z-bookcard');
          if (closest) return closest;
        }
        var rootNode = current.getRootNode ? current.getRootNode() : null;
        if (rootNode && rootNode.host) {
          current = rootNode.host;
          continue;
        }
        current = current.parentElement || current.parentNode || null;
      }
      return null;
    }

    function scanOne(el, href) {
      var parsedUrl = null;
      try {
        var baseOrigin = window.location.origin || '';
        parsedUrl = new URL(href, baseOrigin);
      } catch (e) {}
      if (!parsedUrl) return;
      var checkedHref = parsedUrl.pathname;
      if (!checkedHref || !checkedHref.startsWith('/book/')) return;
      if (parsedUrl.origin !== window.location.origin) return;
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return;
      // Dedup by raw href + normalized href/pathname so relative/absolute
      // duplicates collapse without losing same-origin absolute URLs.
      if (seen[href]) return;
      if (seen[parsedUrl.href]) return;
      if (seen[checkedHref]) return;
      seen[href] = true;
      seen[parsedUrl.href] = true;
      seen[checkedHref] = true;

      var sourceEl = el && el.tagName && String(el.tagName).toLowerCase() === 'a'
        ? (findEnclosingBookcard(el) || el)
        : el;

      var id = sourceEl.getAttribute('id') || '';
      var title = sourceEl.getAttribute('title') || '';
      var author = sourceEl.getAttribute('author') || '';

      // If title/author aren't HTML attrs, try slotted children
      if (!title) {
        var tSlot = sourceEl.querySelector('[slot="title"]');
        if (tSlot) title = (tSlot.textContent || '').trim();
      }
      if (!author) {
        var aSlot = sourceEl.querySelector('[slot="author"]');
        if (aSlot) author = (aSlot.textContent || '').trim();
      }

      var url = parsedUrl.href;

      // Extract full <z-bookcard> attributes (mirrors dom.js extractSearchResults)
      var language = sourceEl.getAttribute('language') || '';
      var extension = sourceEl.getAttribute('extension') || '';
      var size = sourceEl.getAttribute('filesize') || '';
      var year = sourceEl.getAttribute('year') || '';
      // eslint-disable-next-line no-var  -  surrounding evaluate block uses var for consistency
      var rawQuality = sourceEl.getAttribute('quality');
      var formatQualityRating = rawQuality && rawQuality !== '0.0' && rawQuality !== '0' ? rawQuality : null;
      var rawRating = sourceEl.getAttribute('rating');
      var qualityRating = rawRating && rawRating !== '0.0' && rawRating !== '0' ? rawRating : null;
      var publisher = sourceEl.getAttribute('publisher') || '';
      var isbn = sourceEl.getAttribute('isbn') || '';
      var md5 = sourceEl.getAttribute('md5') || '';
      var series = sourceEl.getAttribute('series') || '';
      var categories = sourceEl.getAttribute('categories') || '';

      rows.push({
        bookId: id,
        url: url,
        title: title,
        author: author,
        readlistBookId: sourceEl.getAttribute(${JSON.stringify(BOOKLIST_MEMBERSHIP_ID_ATTRIBUTE)}) || '',
        language: language,
        extension: extension,
        size: size,
        year: year,
        formatQualityRating: formatQualityRating,
        qualityRating: qualityRating,
        publisher: publisher,
        isbn: isbn,
        md5: md5,
        series: series,
        categories: categories
      });
    }

    function scanNode(root) {
      if (!root || rows.length >= maxExpected) return;

      // 1. z-bookcard custom elements (primary  -  booklist detail pages)
      var cards = root.querySelectorAll('z-bookcard[href*="/book/"]');
      for (var c = 0; c < cards.length && rows.length < maxExpected; c++) {
        scanOne(cards[c], cards[c].getAttribute('href') || '');
      }

      // 2. <a> anchors (fallback  -  search-result pages)
      var anchors = root.querySelectorAll('a[href*="/book/"]');
      for (var a = 0; a < anchors.length && rows.length < maxExpected; a++) {
        scanOne(anchors[a], anchors[a].getAttribute('href') || anchors[a].href || '');
      }

      // 3. Recurse into open shadow roots
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) scanNode(all[i].shadowRoot);
      }
    }

    scanNode(document);
    return JSON.stringify(rows);
  ` + '})()')

  return parseJsonOrDefault(raw, [])
}

/**
 * Try to click the "Show more" / "Load more" button on the current page.
 *
 * The Z-Library booklist detail page uses:
 *   <div class="page-load-more" onclick="loadMoreBooks(this)">
 *     <span class="content">Show more</span>
 *   </div>
 *
 * Uses class, onclick, and text-content selectors in priority order.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<boolean>} true if a button was found and clicked
 */
async function clickBooklistLoadMore (page) {
  return await page.evaluate('(function() {' + `
    // Priority 1: known class/onclick patterns
    var primary = document.querySelector('div.page-load-more, [class*="load-more"], [class*="load_more"], [onclick*="loadMore"]');
    if (primary) { primary.click(); return true; }

    // Priority 2: text content match  -  "Show more", "Load more", "もっと見る" etc.
    var keywords = ['show more', 'load more', 'view more', 'see more', 'もっと', 'すべて表示'];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var text = (all[i].textContent || '').trim().toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (text === keywords[k] || text.indexOf(keywords[k]) !== -1) {
          all[i].click();
          return true;
        }
      }
    }

    // Priority 3: class-based fragment matching
    for (var i = 0; i < all.length; i++) {
      var cls = (all[i].className || '') + ' ' + (all[i].getAttribute('class') || '');
      if (cls.indexOf('load') !== -1 || cls.indexOf('more') !== -1) {
        var t = (all[i].textContent || '').trim().toLowerCase();
        if (t.indexOf('show') !== -1 || t.indexOf('more') !== -1) {
          all[i].click();
          return true;
        }
      }
    }

    return false;
  ` + '})()')
}

/**
 * Wait for DOM progress after a load-more click.
 *
 * Polls readProgress() every 500ms until the consumer's success condition
 * holds (snapshot.found != null), the rendered card count grew past the
 * pre-click count (next page loaded), or 10s elapsed. Shared by
 * getBooklistBooks() pagination and resolveReadlistBookIdFromDom() so both
 * consumers of the same Electron detail page use identical wait semantics —
 * a slow webview must not cause a false "book not found".
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {(page) => Promise<{found: *, count: number, [key: string]: *}>} readProgress
 *   Async snapshot reader. `found` is the consumer's success value (null =
 *   not satisfied); `count` is the rendered bookcard count. Extra fields
 *   pass through unchanged on the returned snapshot.
 * @param {number} prevCount - Rendered card count before the click
 * @returns {Promise<{found: *, count: number}>} Final snapshot
 * @private
 */
async function waitForLoadMoreProgress (page, readProgress, prevCount) {
  const startedAt = Date.now()
  const timeoutMs = 10000
  const pollIntervalMs = 500

  let snapshot = await readProgress(page)
  while (snapshot.found == null && snapshot.count <= prevCount && Date.now() - startedAt < timeoutMs) {
    await sleepPromise(pollIntervalMs)
    snapshot = await readProgress(page)
  }
  return snapshot
}

/** @param {number} ms */
function sleepPromise (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

// ---------------------------------------------------------------------------
// Diagnostic exports  -  for doctor commands that test the production path
// ---------------------------------------------------------------------------

/**
 * Diagnostic: extract book rows from the current booklist detail page DOM.
 * Same implementation as the private `extractBooklistBookRows()`.
 *
 * Exported so doctor commands can probe the exact same extraction path used
 * by booklist-export and booklist-download without duplicating selector logic.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} origin
 * @param {number} expectedCount
 * @returns {Promise<Array<object>>}
 */
export async function diagnoseExtractBookRows (page, origin, expectedCount) {
  return extractBooklistBookRows(page, origin, expectedCount)
}

/**
 * Diagnostic: click "Show more" / "Load more" on the current page.
 * Same implementation as the private `clickBooklistLoadMore()`.
 *
 * Exported so doctor commands can probe the production pagination path.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<boolean>}
 */
export async function diagnoseClickLoadMore (page) {
  return clickBooklistLoadMore(page)
}

/**
 * Diagnostic: scan the current booklist detail page DOM for a z-bookcard
 * matching bookId and return its booklistsindex value.
 * Same implementation as the private `scanBooklistDetailForReadlistBookId()`.
 *
 * Exported so doctor commands and tests can probe the exact membership-id
 * resolution path used by booklist-manage --delete-book-id.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string|number} bookId - The book ID to match
 * @returns {Promise<string|null>} readlistBookId string or null if not found
 */
export async function diagnoseScanBooklistDetailForReadlistBookId (page, bookId) {
  const result = await scanBooklistDetailForReadlistBookId(page, String(bookId))
  return result.readlistBookId
}
