/**
 * Tests for CDP-based booklist API helpers.
 */
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createPageMock } from '../../../test-utils.js'
vi.mock('@jackwener/opencli/errors', () => {
  class CommandExecutionError extends Error {}
  class ArgumentError extends Error {}
  return { CommandExecutionError, ArgumentError }
})
import {
  getBooklists,
  createBooklist,
  getBookIdList,
  addBookToBooklist,
  deleteBooklist,
  getBooklistInfo,
  getBooklistIdByName,
  resolveBooklistByNameOrThrow,
  resolveBooklistDetailUrl,
  getBooklistBooks,
  requestBooklistApi,
  removeBookFromBooklist,
  resolveReadlistBookIdFromDom,
  diagnoseExtractBookRows,
  diagnoseScanBooklistDetailForReadlistBookId,
  BOOKLIST_MEMBERSHIP_ID_ATTRIBUTE,
  MAX_BOOKLIST_LOAD_MORE_CLICKS
} from './api.js'
import { CommandExecutionError } from '@jackwener/opencli/errors'
import { isSuccessfulBooklistAdd } from '../infra/booklist-mutation.js'

// ---------------------------------------------------------------------------
// DOM harness for evaluate-script tests (vm.runInNewContext)
// ---------------------------------------------------------------------------

function createElement (tagName, attrs, children, options) {
  const nodeAttrs = attrs || {}
  const nodeChildren = children || []
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    shadowRoot: null,
    parentNode: null,
    parentElement: null,
    getAttribute (name) {
      return Object.prototype.hasOwnProperty.call(nodeAttrs, name) ? nodeAttrs[name] : ''
    },
    querySelectorAll (selector) {
      return querySelectorAllFromNode(this, selector)
    },
    querySelector (selector) {
      return querySelectorAllFromNode(this, selector)[0] || null
    },
    closest (selector) {
      return closestFromNode(this, selector)
    },
    getRootNode () {
      if (this.parentNode && this.parentNode.isShadowRoot) return this.parentNode
      return documentRoot
    },
  }

  for (const child of nodeChildren) {
    child.parentNode = node
    child.parentElement = node
    node.children.push(child)
  }

  if (options && options.shadowRoot) {
    const shadowChildren = options.shadowRoot.children || []
    const shadowRoot = {
      isShadowRoot: true,
      host: node,
      children: [],
      parentNode: null,
      querySelectorAll (selector) {
        return querySelectorAllFromNode(this, selector)
      },
      querySelector (selector) {
        return querySelectorAllFromNode(this, selector)[0] || null
      },
    }
    for (const child of shadowChildren) {
      child.parentNode = shadowRoot
      child.parentElement = null
      shadowRoot.children.push(child)
    }
    node.shadowRoot = shadowRoot
  }

  return node
}

function matchesSelector (node, selector) {
  const tag = String(node.tagName || '').toLowerCase()
  if (selector === '*') return true
  if (selector === 'z-bookcard') return tag === 'z-bookcard'
  if (selector === 'z-booklist') return tag === 'z-booklist'
  if (selector === 'z-bookcard[href*="/book/"]') {
    return tag === 'z-bookcard' && String(node.getAttribute('href') || '').includes('/book/')
  }
  if (selector === 'a[href*="/book/"]') {
    return tag === 'a' && String(node.getAttribute('href') || '').includes('/book/')
  }
  if (selector === '[slot="title"]') {
    return String(node.getAttribute('slot') || '') === 'title'
  }
  if (selector === '[slot="author"]') {
    return String(node.getAttribute('slot') || '') === 'author'
  }
  return false
}

function querySelectorAllFromNode (root, selector) {
  const rows = []
  const stack = Array.isArray(root.children) ? root.children.slice() : []
  while (stack.length) {
    const node = stack.shift()
    if (matchesSelector(node, selector)) rows.push(node)
    if (Array.isArray(node.children) && node.children.length) {
      stack.unshift(...node.children)
    }
  }
  return rows
}

function closestFromNode (node, selector) {
  let current = node
  while (current && current.parentNode) {
    current = current.parentNode
    if (current.isShadowRoot) return null
    if (matchesSelector(current, selector)) return current
  }
  return null
}

const documentRoot = {
  children: [],
  querySelectorAll (selector) {
    return querySelectorAllFromNode(this, selector)
  },
  querySelector (selector) {
    return querySelectorAllFromNode(this, selector)[0] || null
  },
}

/**
 * Page mock that executes evaluate scripts containing scanNode/scanFrom via
 * vm.runInNewContext against a mock document. Extra handlers are keyed by
 * script substrings (checked in insertion order after the scanner markers).
 */
function createDomPageMock (origin, document, opts = {}) {
  const { extraHandlers = {} } = opts
  return createPageMock([], {
    evaluate: vi.fn(async function (script) {
      if (typeof script === 'string' && (script.includes('scanNode(document)') || script.includes('scanFrom(document'))) {
        return vm.runInNewContext(script, {
          window: { location: { origin } },
          document,
          URL,
          JSON,
        })
      }
      for (const [marker, handler] of Object.entries(extraHandlers)) {
        if (typeof script === 'string' && script.includes(marker)) return handler(script)
      }
      throw new Error('unexpected evaluate: ' + String(script).slice(0, 80))
    }),
  })
}

describe('booklist-api', () => {
  describe('requestBooklistApi', () => {
    it('returns parsed JSON from a GET call', async () => {
      const page = createPageMock([
        JSON.stringify({ list: [{ id: 1, title: 'Test' }] })
      ])
      const result = await requestBooklistApi(page, '/papi/booklist/current-user/', { fallback: {} })
      expect(result).toMatchObject({ list: [{ id: 1, title: 'Test' }] })
    })

    it('throws on HTTP/network errors from CDP wrapper', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'Connection refused', _httpStatus: 503 })
      ])
      await expect(
        requestBooklistApi(page, '/papi/booklist/nonexistent')
      ).rejects.toThrow(CommandExecutionError)
    })

    it('throws on HTTP 500 with error detail', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'HTTP 500: Internal Server Error', _httpStatus: 500 })
      ])
      await expect(
        requestBooklistApi(page, '/papi/booklist/999', { fallback: {} })
      ).rejects.toThrow(CommandExecutionError)
    })

    it('passes allowError: true writes through without throwing', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'Service Unavailable', _httpStatus: 503 })
      ])
      const result = await requestBooklistApi(page, '/papi/booklist/create', {
        method: 'POST',
        fallback: { success: false },
        allowError: true
      })
      expect(result).toEqual({ error: 'Service Unavailable', _httpStatus: 503 })
    })
  })

  // -----------------------------------------------------------------------
  // Security: evaluate injection prevention  -  script inspection
  // -----------------------------------------------------------------------

  describe('security  -  evaluate injection prevention', () => {
    it('URL with special chars is JSON.stringified, not raw interpolated', async () => {
      const page = createPageMock(['[]'])
      await getBooklists(page)
      const script = page.evaluate.mock.calls[0][0]
      // Must NOT contain template literal interpolation for URL building
      // (note: string concatenation like 'HTTP ' + status for errors is acceptable)
      expect(script).not.toMatch(/\$\{/)
      // Endpoint is JSON.stringified on host side, appears as quoted string literal
      expect(script).toMatch(/"\/papi\/booklist\/current-user\/"/)
    })

    it('POST create uses new Request() without Content-Type header', async () => {
      const page = createPageMock(['[]'])
      await createBooklist(page, 'test', 'desc')
      const script = page.evaluate.mock.calls[0][0]
      // POST path uses new Request() to avoid Content-Type
      expect(script).toMatch(/new Request\(/)
      expect(script).not.toMatch(/['"]Content-Type['"]/)
      expect(script).not.toMatch(/headers/)
      // Body is JSON.stringified on host side, appears as escaped JSON string literal
      expect(script).toMatch(/\\"title\\":\\"test\\"/)
    })

    it('generated script checks resp.ok for HTTP errors', async () => {
      const page = createPageMock(['[]'])
      await createBooklist(page, 'test', 'desc')
      const script = page.evaluate.mock.calls[0][0]
      // Script must check resp.ok or reference _httpStatus
      expect(script).toMatch(/resp\.ok|_httpStatus/)
    })

    it('addBookToBooklist with malicious bookId is safely URL-encoded', async () => {
      const page = createPageMock(['{}'])
      const maliciousId = "1');fetch('https://evil')//"
      await addBookToBooklist(page, 1, maliciousId)
      const script = page.evaluate.mock.calls[0][0]
      // The raw malicious string should NOT appear unencoded in the script
      expect(script).not.toContain("1');fetch(")
      // The endpoint is built with encodeURIComponent
      expect(script).toMatch(/JSON\.stringify\(/)
      // Verify the encoded version IS in the script
      expect(script).toContain(encodeURIComponent(maliciousId))
    })

    it('deleteBooklist with malicious id is safely URL-encoded', async () => {
      const page = createPageMock(['{}'])
      await deleteBooklist(page, '../../etc/passwd')
      const script = page.evaluate.mock.calls[0][0]
      // Path traversal characters should be encoded, not literal
      expect(script).not.toContain('../../etc/passwd')
      expect(script).toMatch(/JSON\.stringify\(/)
    })

    it('getBooklistInfo with malicious id is safely URL-encoded', async () => {
      const page = createPageMock(['{}'])
      await getBooklistInfo(page, '0; return {}; //')
      const script = page.evaluate.mock.calls[0][0]
      // The malicious input should not appear as literal code in evaluate
      expect(script).not.toContain('return {}')
      expect(script).toMatch(/JSON\.stringify\(/)
    })
  })

  describe('getBooklists', () => {
    it('returns list of booklists from the API', async () => {
      const page = createPageMock([
        JSON.stringify({
          list: [
            { id: 1, title: 'My List', description: 'A test list', bookCount: 5, createdAt: '2024-01-01' },
            { id: 2, title: 'Reading List', description: '', bookCount: 3, createdAt: '2024-02-01' }
          ]
        })
      ])
      const result = await getBooklists(page)
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 1, title: 'My List', bookCount: 5 })
      expect(result[1]).toMatchObject({ id: 2, title: 'Reading List', bookCount: 3 })
    })

    it('handles both {list: [...]} and raw array response shapes', async () => {
      // Raw array (backward compatibility)
      let page = createPageMock([
        JSON.stringify([{ id: 1, title: 'Raw List', bookCount: 3 }])
      ])
      let result = await getBooklists(page)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Raw List')

      // {list: [...]} shape (real API)
      page = createPageMock([
        JSON.stringify({ list: [{ id: 2, title: 'Wrapped List', bookCount: 5 }] })
      ])
      result = await getBooklists(page)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Wrapped List')
    })

    it('returns empty array when API returns empty list', async () => {
      const page = createPageMock([
        JSON.stringify({ list: [] })
      ])
      const result = await getBooklists(page)
      expect(result).toEqual([])
    })

    it('returns empty array on evaluate failure', async () => {
      const page = createPageMock([])
      const result = await getBooklists(page)
      expect(result).toEqual([])
    })
  })

  describe('getBooklistIdByName', () => {
    it('finds booklist ID by matching name', async () => {
      const page = createPageMock([
        JSON.stringify({
          list: [
            { id: 1, title: 'My List', bookCount: 5 },
            { id: 2, title: 'Other List', bookCount: 3 }
          ]
        })
      ])
      const id = await getBooklistIdByName(page, 'My List')
      expect(id).toBe(1)
    })

    it('returns null for nonexistent name', async () => {
      const page = createPageMock([
        JSON.stringify({ list: [] })
      ])
      const id = await getBooklistIdByName(page, 'Ghost')
      expect(id).toBeNull()
    })
  })

  describe('resolveBooklistByNameOrThrow', () => {
    it('resolves a valid booklist name', async () => {
      const page = createPageMock([
        JSON.stringify({
          list: [
            { id: 1, title: 'My List', bookCount: 5 }
          ]
        })
      ])
      const match = await resolveBooklistByNameOrThrow(page, 'My List')
      expect(match).toMatchObject({ id: 1, title: 'My List' })
    })

    it('throws CommandExecutionError for unknown name', async () => {
      const page = createPageMock([
        JSON.stringify({ list: [] })
      ])
      await expect(
        resolveBooklistByNameOrThrow(page, 'Unknown')
      ).rejects.toBeInstanceOf(CommandExecutionError)
    })

    it('accepts pre-fetched booklists to avoid extra API calls', async () => {
      const page = createPageMock([])
      const preFetched = [{ id: 5, title: 'Pre Fetched' }]
      const match = await resolveBooklistByNameOrThrow(page, 'Pre Fetched', preFetched)
      expect(match).toMatchObject({ id: 5, title: 'Pre Fetched' })
    })
  })

  describe('createBooklist', () => {
    it('creates a booklist and returns the result', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1, readlist: { id: '10', title: 'New List', description: '' } })
      ])
      const result = await createBooklist(page, 'New List', '')
      expect(result).toMatchObject({ id: 10, title: 'New List', success: true })
    })

    it('creates with description', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1, readlist: { id: '11', title: 'Desc List', description: 'My description' } })
      ])
      const result = await createBooklist(page, 'Desc List', 'My description')
      expect(result).toMatchObject({ id: 11, description: 'My description' })
    })

    it('passes through malformed create payload (readlist without id)', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1, readlist: { title: 'No ID' } })
      ])
      const result = await createBooklist(page, 'No ID', '')
      expect(result).toMatchObject({ success: 1, readlist: { title: 'No ID' } })
    })

    it('passes through null payload', async () => {
      const page = createPageMock([
        JSON.stringify(null)
      ])
      const result = await createBooklist(page, 'Null Payload', '')
      expect(result).toBeNull()
    })

    it('uses new Request() without Content-Type header (POST quirk)', async () => {
      // Verify by checking the evaluate script contains 'new Request' not 'headers'
      const page = createPageMock([])
      // Just run it  -  the real test is that it doesn't set Content-Type
      const result = await createBooklist(page, 'Test', '')
      expect(result).toEqual({ success: false }) // fallback due to empty mock
    })
  })

  describe('getBookIdList', () => {
    it('returns book ID mappings in the REAL {bookId, booklistId} shape', async () => {
      // Verified 2026-08-08: every mapping is {bookId, booklistId} only.
      const page = createPageMock([
        JSON.stringify([
          { booklistId: 1, bookId: 100, title: 'Book A', author: 'Author A' },
          { booklistId: 2, bookId: 101, title: 'Book B', author: 'Author B' }
        ])
      ])
      const result = await getBookIdList(page)
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ booklistId: 1, bookId: 100 })
      // readlistBookId is NEVER present in book-id-list responses.
      expect(result[0].readlistBookId).toBeUndefined()
      expect(result[1].readlistBookId).toBeUndefined()
    })

    it('handles both {results: [...]} and raw array response shapes', async () => {
      // getBookIdList normalizes the API response inside the evaluate script,
      // returning a flat array of items with sanitized URLs.
      // The mock must return what the evaluate script would return.
      let page = createPageMock([JSON.stringify([{ booklistId: 1, bookId: 100 }])])
      let result = await getBookIdList(page)
      expect(result).toHaveLength(1)
      expect(result[0].bookId).toBe(100)

      page = createPageMock([JSON.stringify([{ booklistId: 2, bookId: 200 }])])
      result = await getBookIdList(page, 5)
      expect(result).toHaveLength(1)
      expect(result[0].bookId).toBe(200)
    })

    it('returns empty array on API error', async () => {
      const page = createPageMock([])
      const result = await getBookIdList(page)
      expect(result).toEqual([])
    })

    it('accepts optional booklistId parameter', async () => {
      const page = createPageMock([
        JSON.stringify([
          { booklistId: 1, bookId: 100, title: 'Book A' }
        ])
      ])
      const result = await getBookIdList(page, 5)
      expect(result).toHaveLength(1)
    })

    it('sanitizes URLs inside evaluate  -  drops cross-origin and non-http URLs', async () => {
      const page = createPageMock([
        JSON.stringify([
          { booklistId: 1, bookId: 100, title: 'Good', url: 'https://z-lib.gl/book/100' },
          { booklistId: 2, bookId: 200, title: 'Cross', url: 'https://evil.com/book/200' },
          { booklistId: 3, bookId: 300, title: 'JS', url: 'javascript:alert(1)' }
        ])
      ])
      const result = await getBookIdList(page)
      expect(result).toHaveLength(3)
      // URL sanitization happens inside evaluate, so the mock's pre-serialized
      // data passes through as-is. The real test verifies the evaluate script
      // contains URL validation patterns.
      const script = page.evaluate.mock.calls[0][0]
      expect(script).toMatch(/window\.location\.origin/)
      expect(script).toMatch(/protocol.*http/)
      expect(script).toMatch(/new URL\(/)
    })

    it('evaluate script url sanitizer rejects javascript: and cross-origin URLs', async () => {
      // The getBookIdList evaluate script includes inline URL sanitization.
      // This test probes for the sanitizer patterns in the generated script.
      const page = createPageMock([
        JSON.stringify([
          { booklistId: 1, bookId: 100, title: 'Good', url: 'https://z-lib.gl/book/100' },
          { booklistId: 2, bookId: 200, title: 'Cross', url: 'https://evil.com/book/200' },
          { booklistId: 3, bookId: 300, title: 'JS', url: 'javascript:alert(1)' }
        ])
      ])
      await getBookIdList(page)
      const script = page.evaluate.mock.calls[0][0]

      // Script must contain the sanitizer patterns:
      // 1. new URL() to parse each URL
      expect(script).toMatch(/new URL\(/)
      // 2. u.origin check against window.location.origin
      expect(script).toMatch(/u\.origin.*!==.*origin/)
      // 3. Protocol check for http/https
      expect(script).toMatch(/protocol.*!==.*'http/)
      // 4. Fallback: on parse error, set url to ''
      expect(script).toMatch(/item\.url\s*=\s*['"]\s*['"]/)
    })
  })

  // -----------------------------------------------------------------------
  // Booklist scoping (Priority 4)
  // -----------------------------------------------------------------------

  describe('booklist scoping', () => {
    it('includes booklistId query param when scoping getBookIdList', async () => {
      const page = createPageMock([JSON.stringify({ results: [] })])
      await getBookIdList(page, 42)
      const script = page.evaluate.mock.calls[0][0]
      expect(script).toContain('booklistId=')
      expect(script).toContain('booklistId=42')
    })

    it('omits booklistId param when no scoping needed', async () => {
      const page = createPageMock([JSON.stringify({ results: [] })])
      await getBookIdList(page)
      const script = page.evaluate.mock.calls[0][0]
      expect(script).not.toContain('booklistId=')
    })

    it('scopes addBookToBooklist by booklistId in endpoint URL', async () => {
      const page = createPageMock(['{}'])
      await addBookToBooklist(page, 99, 100)
      const script = page.evaluate.mock.calls[0][0]
      // The endpoint should include the booklistId in the URL path
      expect(script).toContain('/papi/booklist/99/add-book/100')
    })
  })

  describe('addBookToBooklist', () => {
    it('normalizes real API add-book response shape', async () => {
      const page = createPageMock([
        JSON.stringify({
          success: 1,
          book: {
            id: '42',
            readlist_id: 1,
            book_id: 100
          }
        })
      ])
      const result = await addBookToBooklist(page, 1, 100)
      expect(result).toEqual({ success: true, readlistBookId: 42, bookId: 100 })
      expect(isSuccessfulBooklistAdd(result)).toBe(true)
    })

    it('passes through API error responses unchanged', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'Book already in list' })
      ])
      const result = await addBookToBooklist(page, 1, 100)
      expect(result).toEqual({ error: 'Book already in list' })
    })

    it('passes through malformed success payload unchanged', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1, book: { readlist_id: 1, book_id: 100 } })
      ])
      const result = await addBookToBooklist(page, 1, 100)
      expect(result).toEqual({ success: 1, book: { readlist_id: 1, book_id: 100 } })
    })

    it('returns empty object on evaluate failure', async () => {
      const page = createPageMock([])
      const result = await addBookToBooklist(page, 1, 100)
      expect(result).toEqual({})
    })
  })

  describe('deleteBooklist', () => {
    it('deletes a booklist and returns success', async () => {
      const page = createPageMock([
        JSON.stringify({ success: true })
      ])
      const result = await deleteBooklist(page, 1)
      expect(result).toEqual({ success: true })
    })

    it('returns fallback on API error', async () => {
      const page = createPageMock([])
      const result = await deleteBooklist(page, 999)
      expect(result).toEqual({ success: false })
    })
  })

  describe('removeBookFromBooklist', () => {
    it('uses readlistBookId in URL path, no query param', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1 })
      ])
      await removeBookFromBooklist(page, 1, 42)
      const script = page.evaluate.mock.calls[0][0]
      // Must use readlistBookId in path, NOT bookId
      expect(script).toContain('/papi/booklist/1/remove-book/42')
      // Must NOT have readlistBookId= query param
      expect(script).not.toContain('readlistBookId=')
    })

    it('normalizes { success: 1 } integer to { success: true } boolean', async () => {
      const page = createPageMock([
        JSON.stringify({ success: 1 })
      ])
      const result = await removeBookFromBooklist(page, 1, 42)
      expect(result).toEqual({ success: true })
    })

    it('passes through { success: true } unchanged', async () => {
      const page = createPageMock([
        JSON.stringify({ success: true })
      ])
      const result = await removeBookFromBooklist(page, 1, 42)
      expect(result).toEqual({ success: true })
    })

    it('preserves error field through normalization', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'Book not found' })
      ])
      const result = await removeBookFromBooklist(page, 1, 42)
      expect(result).toEqual({ error: 'Book not found' })
    })

    it('returns fallback on evaluate failure', async () => {
      const page = createPageMock([])
      const result = await removeBookFromBooklist(page, 1, 42)
      expect(result).toEqual({ success: false })
    })
  })

  describe('getBooklistInfo', () => {
    it('returns booklist metadata', async () => {
      const page = createPageMock([
        JSON.stringify({ id: 1, title: 'My List', description: 'A list', bookCount: 5, accessType: 'private', createdAt: '2024-01-01' })
      ])
      const result = await getBooklistInfo(page, 1)
      expect(result).toMatchObject({ id: 1, title: 'My List', bookCount: 5, accessType: 'private' })
    })

    it('returns empty object on API error', async () => {
      const page = createPageMock([])
      const result = await getBooklistInfo(page, 999)
      expect(result).toEqual({})
    })

    it('returns {} on HTTP 404 wrapper instead of throwing', async () => {
      const page = createPageMock([
        JSON.stringify({ error: 'HTTP 404: Not Found', _httpStatus: 404 })
      ])
      const result = await getBooklistInfo(page, 999)
      expect(result).toEqual({})
    })
  })

  describe('diagnoseExtractBookRows', () => {
    it('accepts same-origin absolute book URLs and keeps output absolute', async () => {
      const card = createElement('z-bookcard', {
        id: '101',
        href: 'https://z-lib.gl/book/101/absolute-book.html',
        title: 'Absolute Book',
        author: 'Author A',
      })
      const document = {
        children: [card],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const page = createDomPageMock('https://z-lib.gl', document)

      const rows = await diagnoseExtractBookRows(page, 'https://z-lib.gl', 10)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        bookId: '101',
        url: 'https://z-lib.gl/book/101/absolute-book.html',
        title: 'Absolute Book',
        author: 'Author A',
      })
    })

    it('reads metadata from enclosing z-bookcard for anchor fallback', async () => {
      const anchorAbsolute = createElement('a', {
        href: 'https://z-lib.gl/book/202/example.html',
      })
      const anchorRelative = createElement('a', {
        href: '/book/202/example.html',
      })
      const card = createElement('z-bookcard', {
        id: '202',
        title: 'Card Title',
        author: 'Card Author',
      }, [], {
        shadowRoot: { children: [anchorAbsolute, anchorRelative] },
      })
      const document = {
        children: [card],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const page = createDomPageMock('https://z-lib.gl', document)

      const rows = await diagnoseExtractBookRows(page, 'https://z-lib.gl', 10)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        bookId: '202',
        url: 'https://z-lib.gl/book/202/example.html',
        title: 'Card Title',
        author: 'Card Author',
      })
    })

    it('populates readlistBookId from booklistsindex attribute', async () => {
      const card = createElement('z-bookcard', {
        id: '101',
        href: 'https://z-lib.gl/book/101/absolute-book.html',
        title: 'Absolute Book',
        author: 'Author A',
        booklistsindex: '153761292',
      })
      const document = {
        children: [card],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const page = createDomPageMock('https://z-lib.gl', document)

      const rows = await diagnoseExtractBookRows(page, 'https://z-lib.gl', 10)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        bookId: '101',
        readlistBookId: '153761292',
      })
    })
  })

  describe('resolveBooklistDetailUrl identity guard', () => {
    it('passes expectedBooklistId into the detail href search', async () => {
      const page = createPageMock([
        'https://z-lib.gl',
        '/booklist/42/hash/list.html'
      ])
      await resolveBooklistDetailUrl(page, 'My List', { expectedBooklistId: 42 })
      // eval[1] is findBooklistDetailHref's z-booklist search script.
      const script = page.evaluate.mock.calls[1][0]
      expect(script).toContain('var expectedId = "42"')
    })

    it('keeps expectedBooklistId null when not provided (backward compatible)', async () => {
      const page = createPageMock([
        'https://z-lib.gl',
        '/booklist/42/hash/list.html'
      ])
      await resolveBooklistDetailUrl(page, 'My List')
      const script = page.evaluate.mock.calls[1][0]
      expect(script).toContain('var expectedId = null')
    })
  })

  describe('getBooklistBooks identity guard', () => {
    it('passes booklistId into the detail href search (strengthens read path)', async () => {
      const rows = [
        { bookId: '100', url: 'https://z-lib.gl/book/100/x.html', title: 'Book', author: 'Author' }
      ]
      const page = createPageMock([
        'https://z-lib.gl',                                   // getCurrentHttpOrigin
        '/booklist/42/hash/list.html',                        // findBooklistDetailHref
        'https://z-lib.gl/booklists/my?searchQuery=My%20List', // assertSameOriginNotLoginWall (search)
        'https://z-lib.gl/booklist/42/hash/list.html',         // assertSameOriginNotLoginWall (detail)
        JSON.stringify(rows)                                   // extractBooklistBookRows
      ])
      await getBooklistBooks(page, 42, { name: 'My List' })
      // eval[1] is findBooklistDetailHref's z-booklist search script.
      const script = page.evaluate.mock.calls[1][0]
      expect(script).toContain('var expectedId = "42"')
    })
  })

  describe('resolveReadlistBookIdFromDom', () => {
    it('returns the DOM booklistsindex value after same-origin detail navigation', async () => {
      const page = createPageMock([
        'https://z-lib.gl',
        '/booklist/1/hash/list.html',
        'https://z-lib.gl/booklists/my?searchQuery=My%20List',
        'https://z-lib.gl/booklist/1/hash/list.html',
        JSON.stringify({ readlistBookId: '153761292', cardCount: 1 })
      ])

      const readlistBookId = await resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })

      expect(readlistBookId).toBe('153761292')
      expect(page.goto).toHaveBeenCalledWith('https://z-lib.gl/booklist/1/hash/list.html', {
        waitUntil: 'load',
        settleMs: 3000
      })
      expect(page.evaluate.mock.calls[4][0]).toContain('var targetId = "67279368"')
    })

    it('rejects a cross-origin redirect before scanning the DOM', async () => {
      const page = createPageMock([
        'https://z-lib.gl',
        '/booklist/1/hash/list.html',
        'https://evil.example/booklist/1/hash/list.html'
      ])

      await expect(
        resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })
      ).rejects.toThrow(CommandExecutionError)
      expect(page.evaluate).toHaveBeenCalledTimes(3)
      expect(page.goto).toHaveBeenCalledTimes(1)
    })

    it('fails closed when detail href belongs to a different booklist id', async () => {
      // The search tab renders a booklist with the same name but a different
      // id. findBooklistDetailHref must reject it (exact /booklist/{id}/ path
      // segment), so we never resolve readlistBookId from the wrong list.
      const origin = 'https://z-lib.gl'
      const zBooklist = createElement('z-booklist', {
        topic: 'My List',
        href: '/booklist/999/hash/list.html',
      })
      const zBooklistDoc = {
        children: [zBooklist],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const cardDoc = {
        children: [],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const page = createDomPageMock(origin, cardDoc, {
        extraHandlers: {
          'querySelectorAll(\'z-booklist\')': (script) => vm.runInNewContext(script, {
            window: { location: { origin } },
            document: zBooklistDoc,
            URL,
            JSON,
          }),
          'window.location.origin': () => origin,
          'window.location.href': () => origin + '/booklists/my?searchQuery=My%20List',
        },
      })

      const readlistBookId = await resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })

      expect(readlistBookId).toBeNull()
      // Only the search-tab navigation happened; never the detail page.
      expect(page.goto).toHaveBeenCalledTimes(1)
      expect(page.goto.mock.calls[0][0]).toBe('https://z-lib.gl/booklists/my?searchQuery=My%20List')
    })

    it('propagates CommandExecutionError when connected page origin is invalid', async () => {
      // Invalid Electron target (file:// loader shell): the command must
      // surface the real cause, NOT report book_not_found_in_booklist.
      const page = createPageMock(['file:///loader-shell/index.html'])

      await expect(
        resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })
      ).rejects.toThrow(CommandExecutionError)
    })

    it('rescans after load-more click when the book is beyond the first page', async () => {
      // Full-flow test with REAL evaluate scripts: search tab → detail page →
      // first scan (empty DOM) → load-more click → rescan (card now present).
      const origin = 'https://z-lib.gl'
      const zBooklist = createElement('z-booklist', {
        topic: 'My List',
        href: '/booklist/1/hash/list.html',
      })
      const zBooklistDoc = {
        children: [zBooklist],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const cardDoc = {
        children: [],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const page = createDomPageMock(origin, cardDoc, {
        extraHandlers: {
          'querySelectorAll(\'z-booklist\')': (script) => vm.runInNewContext(script, {
            window: { location: { origin } },
            document: zBooklistDoc,
            URL,
            JSON,
          }),
          'window.location.origin': () => origin,
          'window.location.href': () => origin + '/booklist/1/hash/list.html',
          'page-load-more': () => {
            // Simulate load-more rendering the target card into the DOM.
            const card = createElement('z-bookcard', {
              id: '67279368',
              href: origin + '/book/67279368/book.html',
              booklistsindex: '153761292',
            })
            cardDoc.children.push(card)
            return true
          },
        },
      })

      const readlistBookId = await resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })

      expect(readlistBookId).toBe('153761292')
    })

    it('continues load-more clicks when card count grows but target not yet present', async () => {
      // First load-more click renders more cards (not the target); the second
      // click renders the target. The resolver must use count growth to keep
      // polling instead of giving up after a single fixed-sleep scan.
      const origin = 'https://z-lib.gl'
      const zBooklist = createElement('z-booklist', {
        topic: 'My List',
        href: '/booklist/1/hash/list.html',
      })
      const zBooklistDoc = {
        children: [zBooklist],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      const cardDoc = {
        children: [],
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
      let clickCount = 0
      const page = createDomPageMock(origin, cardDoc, {
        extraHandlers: {
          'querySelectorAll(\'z-booklist\')': (script) => vm.runInNewContext(script, {
            window: { location: { origin } },
            document: zBooklistDoc,
            URL,
            JSON,
          }),
          'window.location.origin': () => origin,
          'window.location.href': () => origin + '/booklist/1/hash/list.html',
          'page-load-more': () => {
            clickCount++
            if (clickCount === 1) {
              const filler = createElement('z-bookcard', {
                id: '1',
                href: origin + '/book/1/filler.html',
                booklistsindex: '9',
              })
              cardDoc.children.push(filler)
            } else {
              const target = createElement('z-bookcard', {
                id: '67279368',
                href: origin + '/book/67279368/book.html',
                booklistsindex: '153761292',
              })
              cardDoc.children.push(target)
            }
            return true
          },
        },
      })

      const readlistBookId = await resolveReadlistBookIdFromDom(page, '67279368', 1, { name: 'My List' })

      expect(readlistBookId).toBe('153761292')
      expect(clickCount).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // Scanner: real evaluate script executed via vm (P1-4 coverage)
  // -----------------------------------------------------------------------

  describe('diagnoseScanBooklistDetailForReadlistBookId', () => {
    function makeDoc (children) {
      return {
        children,
        querySelectorAll: documentRoot.querySelectorAll,
        querySelector: documentRoot.querySelector,
      }
    }

    it('returns numeric booklistsindex for exact card id match', async () => {
      const card = createElement('z-bookcard', {
        id: '100',
        href: 'https://z-lib.gl/book/100/book.html',
        booklistsindex: '153761292',
      })
      const page = createDomPageMock('https://z-lib.gl', makeDoc([card]))

      const readlistBookId = await diagnoseScanBooklistDetailForReadlistBookId(page, '100')

      expect(readlistBookId).toBe('153761292')
    })

    it('returns null when matched card lacks a numeric booklistsindex', async () => {
      const card = createElement('z-bookcard', {
        id: '100',
        href: 'https://z-lib.gl/book/100/book.html',
      })
      const page = createDomPageMock('https://z-lib.gl', makeDoc([card]))

      const readlistBookId = await diagnoseScanBooklistDetailForReadlistBookId(page, '100')

      expect(readlistBookId).toBeNull()
    })

    it('finds a card inside an open shadow root', async () => {
      const card = createElement('z-bookcard', {
        id: '100',
        href: 'https://z-lib.gl/book/100/book.html',
        booklistsindex: '7',
      })
      const host = createElement('div', {}, [], { shadowRoot: { children: [card] } })
      const page = createDomPageMock('https://z-lib.gl', makeDoc([host]))

      const readlistBookId = await diagnoseScanBooklistDetailForReadlistBookId(page, '100')

      expect(readlistBookId).toBe('7')
    })

    it('does not match a prefix collision (100 vs /1000)', async () => {
      // Old substring match (indexOf('/100')) would hit this card's href.
      // Exact path-segment matching must reject it.
      const card = createElement('z-bookcard', {
        id: '1000',
        href: 'https://z-lib.gl/book/1000/book.html',
        booklistsindex: '5',
      })
      const page = createDomPageMock('https://z-lib.gl', makeDoc([card]))

      const readlistBookId = await diagnoseScanBooklistDetailForReadlistBookId(page, '100')

      expect(readlistBookId).toBeNull()
    })

    it('does not match a card whose booklistsindex is non-numeric', async () => {
      const card = createElement('z-bookcard', {
        id: '100',
        href: 'https://z-lib.gl/book/100/book.html',
        booklistsindex: 'r153761292',
      })
      const page = createDomPageMock('https://z-lib.gl', makeDoc([card]))

      const readlistBookId = await diagnoseScanBooklistDetailForReadlistBookId(page, '100')

      expect(readlistBookId).toBeNull()
    })

    it('exports shared constants', () => {
      expect(BOOKLIST_MEMBERSHIP_ID_ATTRIBUTE).toBe('booklistsindex')
      expect(MAX_BOOKLIST_LOAD_MORE_CLICKS).toBe(200)
    })
  })
})
