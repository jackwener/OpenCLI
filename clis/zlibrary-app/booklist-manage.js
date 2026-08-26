/**
 * Z-Library Desktop booklist-manage command.
 *
 * Unified edit command with three mutually exclusive operations:
 *   --add-book-id N       Add a single book by ID
 *   --delete-book-id N    Remove a single book (replaces booklist-remove)
 *   --append-query Q      Search Z-Library and append results
 *
 * Each operation resolves the booklist name first. If not found,
 * the command fails with CommandExecutionError.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import path from 'node:path'
import { ArgumentError } from '@jackwener/opencli/errors'
import { parseBooklistSearchOptions, collectBooksForBooklist, hasBooklistSearchArgs } from './_shared/infra/booklist-search.js'
import {
  resolveBooklistByNameOrThrow,
  resolveBooklistDetailUrl,
  getBookIdList,
  addBookToBooklist,
  removeBookFromBooklist,
  resolveReadlistBookIdFromDom
} from './_shared/booklist/api.js'
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js'
import { addBooksToBooklist, isSuccessfulBooklistAdd } from './_shared/infra/booklist-mutation.js'
import { ManageMutationTraceRecorder } from './_shared/fixture/index.js'

/**
 * Navigate to booklist detail page and capture DOM state after mutation.
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} targetBookId
 * @param {string|number} booklistId
 * @param {string} [booklistName] - Booklist title for resolving real detail URL
 * @returns {Promise<object>}
 */
async function captureManageDomState(page, targetBookId, booklistId, booklistName) {
  try {
    const originUrl = await getCurrentHttpOrigin(page)

    // Navigate to booklist detail page to see mutation result.
    // Try the real detail URL first (with hash/slug path, identity-verified
    // against booklistId), then fall back to the bare URL for diagnostics.
    let navigated = false
    if (booklistName) {
      // resolveBooklistDetailUrl returns relative path (URL security boundary)
      const detailRel = await resolveBooklistDetailUrl(page, booklistName, { expectedBooklistId: booklistId })

      // The resolver navigates to a search tab. Confirm it remained on the
      // original site before using its DOM-derived relative href.
      await assertSameOriginNotLoginWall(page, originUrl, 'booklist-manage')

      if (detailRel) {
        await page.goto(originUrl.origin + detailRel, { waitUntil: 'load', settleMs: 3000 })
        await assertSameOriginNotLoginWall(page, originUrl, 'booklist-manage')
        navigated = true
      }
    }
    if (!navigated) {
      if (booklistId) {
        await page.goto(originUrl.origin + '/booklist/' + booklistId, { waitUntil: 'load', settleMs: 3000 })
        await assertSameOriginNotLoginWall(page, originUrl, 'booklist-manage')
      }
    }

    return await page.evaluate(function (bookId) {
      const result = {
        urlOrigin: window.location.origin,
        urlPath: window.location.pathname + window.location.search,
        targetBookId: bookId,
        targetBookPresent: false,
        visibleTexts: [],
        bookcardsCount: 0,
        errors: [],
      }

      // Exact path-segment match: '/100' must NOT match '/1000/...'.
      function exactSegmentMatch(href, targetId) {
        try {
          var u = new URL(href, window.location.origin);
          var segs = u.pathname.split('/');
          return segs.indexOf(targetId) !== -1;
        } catch (e) { return false; }
      }

      // Check if target book is present in DOM
      // z-bookcard uses id="<bookId>" attribute (confirmed via getBooklistBooks extraction)
      var bookEl = document.querySelector('[id="' + bookId + '"]')
      if (!bookEl) {
        // Fallback: data-book-id attribute on any element
        bookEl = document.querySelector('[data-book-id="' + bookId + '"]')
      }
      if (!bookEl) {
        // Fallback: scan z-bookcard hrefs for this bookId (exact segment)
        var cards = document.querySelectorAll('z-bookcard')
        for (var ci = 0; ci < cards.length; ci++) {
          var c = cards[ci]
          if (c.getAttribute('id') === bookId || exactSegmentMatch(c.getAttribute('href') || '', bookId)) {
            bookEl = c
            break
          }
        }
      }
      result.targetBookPresent = !!bookEl

      // Collect visible text from notices, alerts, messages, toasts
      var noticeEls = document.querySelectorAll('.notice, .alert, .message, .toast, [class*="notice"], [class*="alert"]')
      result.visibleTexts = Array.from(noticeEls).map(function (el) { return (el.textContent || '').trim() }).filter(Boolean)

      // Count visible book cards
      result.bookcardsCount = document.querySelectorAll('z-bookcard, .bookcard, .book-item, [class*="book-card"]').length

      // Collect errors
      var errorEls = document.querySelectorAll('.error, .warning, [class*="error"], [class*="warning"]')
      result.errors = Array.from(errorEls).map(function (el) { return (el.textContent || '').trim() }).filter(Boolean)

      return result
    }, targetBookId)
  } catch (_err) {
    return {
      urlOrigin: '',
      urlPath: '',
      targetBookId: targetBookId,
      targetBookPresent: false,
      visibleTexts: [],
      bookcardsCount: 0,
      errors: ['dom_capture_failed: ' + String(_err.message || _err)],
    }
  }
}

/**
 * Save the mutation trace fixture (when recording) and log the output path.
 *
 * @param {ManageMutationTraceRecorder|null} fixtureRecorder
 */
function saveMutationTrace (fixtureRecorder) {
  const fixturePath = fixtureRecorder ? fixtureRecorder.save() : null
  if (fixturePath) {
    process.stderr.write('[fixture] Mutation trace saved: ' + fixturePath + '\n')
  }
}

export const manageCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-manage',
  access: 'write',
  description: 'Manage a Z-Library booklist: add a book, delete a book, or append search results',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Booklist name (must already exist)'
    },
    {
      name: 'add-book-id',
      type: 'string',
      help: 'Add a single book by Z-Library ID'
    },
    {
      name: 'delete-book-id',
      type: 'string',
      help: 'Remove a single book from the booklist'
    },
    {
      name: 'append-query',
      type: 'string',
      help: 'Search query to find books and append to the booklist'
    },
    {
      name: 'filter-lang-codes',
      type: 'string',
      help: 'Filter by language code (en, ja, zh, fr, de, etc.) — repeatable'
    },
    {
      name: 'filter-lang-names',
      type: 'string',
      help: 'Filter by language display name — repeatable'
    },
    {
      name: 'filter-ext',
      type: 'string',
      help: 'Filter by file extension (pdf, epub, azw3, mobi) — repeatable'
    },
    {
      name: 'filter-year-from',
      type: 'int',
      help: 'Filter by minimum publication year (inclusive) — applies to --append-query'
    },
    {
      name: 'filter-year-to',
      type: 'int',
      help: 'Filter by maximum publication year (inclusive) — applies to --append-query'
    },
    {
      name: 'limit',
      type: 'int',
      help: 'Max results to add, default 50 (1–50)'
    },
    {
      name: 'unlimited',
      type: 'boolean',
      help: 'Fetch all search results across multiple pages (up to ~1000)'
    },
    {
      name: 'fixture',
      type: 'boolean',
      default: false,
      help: 'Save mutation trace fixture for offline diagnosis'
    },
    {
      name: 'fixture-dir',
      type: 'string',
      help: 'Target directory for --fixture output (default: fixture/)'
    }
  ],
  columns: ['operation', 'booklist', 'bookId', 'added', 'skipped', 'total', 'reason'],
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-manage name cannot be empty',
        'Example: opencli zlibrary-app booklist-manage mylist --add-book-id 5433175'
      )
    }

    // Exactly one operation flag required
    const ops = ['add-book-id', 'delete-book-id', 'append-query']
    const provided = ops.filter(function (k) { return kwargs[k] != null && kwargs[k] !== '' })

    if (provided.length === 0) {
      throw new ArgumentError(
        'Requires exactly one operation flag',
        'Pick one: --add-book-id, --delete-book-id, --append-query'
      )
    }
    if (provided.length > 1) {
      throw new ArgumentError(
        'Operation flags are mutually exclusive',
        'Got ' + provided.length + ': ' + provided.join(', ') + '. Use one at a time.'
      )
    }

    const operation = provided[0]

    // --fixture is not supported with --append-query
    if (operation === 'append-query' && kwargs.fixture) {
      throw new ArgumentError(
        '--fixture is not supported with --append-query',
        'Use --fixture with --add-book-id or --delete-book-id only.'
      )
    }

    // Parse and validate filter args BEFORE browser/API work (early validation)
    const options = parseBooklistSearchOptions(kwargs, 'manage')

    // Reject search-only filter flags when operation is not --append-query
    if (operation !== 'append-query' && hasBooklistSearchArgs(kwargs)) {
      throw new ArgumentError(
        'booklist-manage search filter flags (--filter-*) only apply to --append-query',
        'Use --filter-* with --append-query, or omit them for --add-book-id / --delete-book-id.'
      )
    }

    // Set up fixture recorder BEFORE API work (captures resolve errors too)
    const fixtureRecorder = kwargs.fixture
      ? new ManageMutationTraceRecorder({
          enabled: true,
          operation: operation,
          booklistName: name,
          bookId: String(kwargs[operation] || '').trim(),
          fixtureDir: path.resolve(String(kwargs['fixture-dir'] || 'fixture')),
        })
      : null

    // Resolve booklist name to ID (throws CommandExecutionError if not found)
    let match
    try {
      match = await resolveBooklistByNameOrThrow(page, name)
    } catch (err) {
      if (fixtureRecorder) {
        fixtureRecorder.setError({ phase: 'resolveBooklist', type: err.constructor?.name || 'Error', message: err.message })
        fixtureRecorder.save()
      }
      throw err
    }
    const booklistId = match.id

    if (fixtureRecorder) {
      fixtureRecorder.setBooklist({ id: match.id, title: match.title || name })
    }

    // -----------------------------------------------------------------------
    // Operation: --add-book-id
    // -----------------------------------------------------------------------
    if (operation === 'add-book-id') {
      const bookId = String(kwargs['add-book-id']).trim()
      if (!bookId || isNaN(Number(bookId))) {
        throw new ArgumentError('--add-book-id must be a number')
      }

      const t0 = Date.now()
      const result = await addBookToBooklist(page, booklistId, bookId)
      const success = isSuccessfulBooklistAdd(result)

      let _domState = null

      if (fixtureRecorder) {
        fixtureRecorder.recordApiPhase('addBook', {
          method: 'GET',
          url: '/papi/booklist/' + booklistId + '/add-book/' + bookId,
          httpStatus: result && !result.error ? 200 : (result && result.error ? 500 : 0),
          body: result || null,
          elapsedMs: Date.now() - t0,
        })

        // Capture DOM state after mutation (navigate to detail page first)
        _domState = await captureManageDomState(page, bookId, booklistId, name)
        fixtureRecorder.recordDomPhase('afterMutationDom', _domState)

        // Assertions
        fixtureRecorder.recordAssertion('api-response-shape',
          success ? 'pass' : 'fail',
          success ? 'response has readlistBookId' : 'add failed: ' + (result && result.error ? result.error : 'unknown'))
        fixtureRecorder.recordAssertion('dom-reflects-mutation',
          _domState.targetBookPresent ? 'pass' : 'fail',
          _domState.targetBookPresent ? 'target book visible after add' : 'target book not visible after add')
      }

      // Determine add result — API success, DOM postcondition (fixture), or already-in-booklist
      let addedCount = success ? 1 : 0
      let failReason = success ? '' : (result && result.error ? 'add_failed: ' + result.error : 'add_failed')
      if (!success) {
        if (fixtureRecorder && _domState && _domState.targetBookPresent) {
          // Fixture mode: DOM confirms book present despite API failure
          addedCount = 1
          failReason = result && result.error ? 'api_failed_dom_passed: HTTP 400: ' + result.error : 'api_failed_dom_passed'
        } else {
          // Non-fixture: check if book already in booklist (server rejects duplicate add)
          try {
            const preexistingMappings = await getBookIdList(page, booklistId)
            if (Array.isArray(preexistingMappings) && preexistingMappings.some(function (m) { return String(m.bookId) === bookId })) {
              addedCount = 1
              failReason = 'already_in_booklist'
            }
          } catch (_) { /* lookup failure — keep original add_failed reason */ }
        }
      }

      saveMutationTrace(fixtureRecorder)

      return [{
        operation: 'add-book-id',
        booklist: name,
        bookId,
        added: addedCount,
        skipped: 0,
        total: 1,
        reason: failReason
      }]
    }

    // -----------------------------------------------------------------------
    // Operation: --delete-book-id
    // -----------------------------------------------------------------------
    if (operation === 'delete-book-id') {
      const bookId = String(kwargs['delete-book-id']).trim()
      if (!bookId || isNaN(Number(bookId))) {
        throw new ArgumentError('--delete-book-id must be a number')
      }

      // Resolve readlistBookId from DOM (z-bookcard booklistsindex attribute).
      // The /papi/booklist/book-id-list API does NOT return readlistBookId —
      // it only returns {bookId, booklistId} mappings. The readlistBookId
      // exists only as the booklistsindex attribute on z-bookcard elements
      // in the booklist detail page DOM.
      const msResolveStartedAt = Date.now()
      const readlistBookId = await resolveReadlistBookIdFromDom(page, bookId, booklistId, { name })

      if (readlistBookId == null) {
        if (fixtureRecorder) {
          fixtureRecorder.recordApiPhase('resolveReadlistBookId', {
            method: 'DOM',
            url: '/booklist/' + booklistId,
            httpStatus: 200,
            body: { readlistBookId: null, method: 'DOM-scan' },
            elapsedMs: Date.now() - msResolveStartedAt,
          })
          // Capture DOM state to show book presence
          const domState = await captureManageDomState(page, bookId, booklistId, name)
          fixtureRecorder.recordDomPhase('afterMutationDom', domState)
          fixtureRecorder.recordAssertion('dom-reflects-mutation', 'fail', 'book not found in booklist (DOM scan returned no readlistBookId)')
          saveMutationTrace(fixtureRecorder)
        }
        return [{
          operation: 'delete-book-id',
          booklist: name,
          bookId,
          added: 0,
          skipped: 0,
          total: 1,
          reason: 'book_not_found_in_booklist'
        }]
      }

      const msRemoveStartedAt = Date.now()
      const result = await removeBookFromBooklist(page, booklistId, readlistBookId)

      if (fixtureRecorder) {
        fixtureRecorder.recordApiPhase('resolveReadlistBookId', {
          method: 'DOM',
          url: '/booklist/' + booklistId,
          httpStatus: 200,
          body: { readlistBookId: readlistBookId, method: 'DOM-scan' },
          elapsedMs: Date.now() - msResolveStartedAt,
        })
        fixtureRecorder.recordApiPhase('removeBook', {
          method: 'GET',
          url: '/papi/booklist/' + booklistId + '/remove-book/' + readlistBookId,
          httpStatus: result && !result.error ? 200 : (result && result.error ? 500 : 0),
          body: result || null,
          elapsedMs: Date.now() - msRemoveStartedAt,
        })

        // Capture DOM state after mutation (navigate to detail page first)
        const domState = await captureManageDomState(page, bookId, booklistId, name)
        fixtureRecorder.recordDomPhase('afterMutationDom', domState)

        // Assertions
        const removeSuccess = result.success === true
        fixtureRecorder.recordAssertion('api-response-shape',
          removeSuccess ? 'pass' : 'fail',
          removeSuccess ? 'remove succeeded' : 'remove failed: ' + (result && result.error ? result.error : 'unknown'))
        fixtureRecorder.recordAssertion('dom-reflects-mutation',
          !domState.targetBookPresent ? 'pass' : 'fail',
          !domState.targetBookPresent ? 'target book no longer visible after remove' : 'target book still visible after remove')
      }

      saveMutationTrace(fixtureRecorder)

      return [{
        operation: 'delete-book-id',
        booklist: name,
        bookId,
        added: 0,
        skipped: 0,
        total: 1,
        reason: result.success === true ? '' : (result && result.error ? 'remove_failed: ' + result.error : 'remove_failed')
      }]
    }

    // -----------------------------------------------------------------------
    // Operation: --append-query
    // -----------------------------------------------------------------------
    const query = String(kwargs['append-query'] || '').trim()
    if (!query) {
      throw new ArgumentError('--query is required with --append-query')
    }

    // NOTE: getBookIdList() returns ALL booklist-book mappings across all
    // booklists (the API ignores ?booklistId=N). Skip client-side dedup.
    const books = await collectBooksForBooklist(page, query, options, 'manage')

    // Add books using shared mutation module — server handles dedup
    const { added, skipped, lastBookId } = await addBooksToBooklist(page, booklistId, books, {
      dedupe: false,
    })

    return [{
      operation: 'append-query',
      booklist: name,
      bookId: lastBookId,
      added,
      skipped,
      total: books.length,
      reason: ''
    }]
  }
})
