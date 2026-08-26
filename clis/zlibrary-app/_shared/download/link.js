/**
 * Shared download link extraction for Z-Library Desktop.
 *
 * Navigates to a book's detail page, reveals download options,
 * extracts the native /dl/ URL, and parses the format.
 *
 * Used by both `download.js` (single-book) and `booklist-download.js` (batch).
 *
 * @module _shared/download-link
 */

import { CommandExecutionError } from '@jackwener/opencli/errors'
import { DOWNLOAD_FORMATS } from './contracts.js'

/**
 * Synchronous error constructor for download-link extraction failures.
 * @param {string} phase - which step failed
 * @param {string} bookId
 * @param {object} [diag] - optional diagnostic details
 * @throws {Error}
 */
function failAt(phase, bookId, diag) {
  const msg = [
    'Download-link extraction failed at', phase,
    'for book', bookId,
    diag ? '(' + JSON.stringify(diag) + ')' : ''
  ].join(' ');
  throw new CommandExecutionError(msg);
}

/**
 * Browser-side: Attempt to extract a download link from the current page
 * without clicking any menu. Fast path.
 *
 * @returns {{url: string, label: string}|null}
 */
function extractDownloadLinkDirect() {
  const origin = window.location.origin
  const links = Array.from(document.querySelectorAll('a[href*="/dl/"]'))
  for (const link of links) {
    const href = link.getAttribute('href') || link.href || ''
    try {
      const parsed = new URL(href, origin)
      if (
        parsed.origin === origin &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.pathname.indexOf('/dl/') !== -1
      ) {
        return { url: parsed.href, label: (link.textContent || '').trim() }
      }
    } catch { /* next */ }
  }
  return null
}

/**
 * Browser-side: Aggressive fallback  -  scan EVERY element on the page for ANY
 * attribute whose value contains "/dl/". This catches download links hidden in
 * data-* attributes (data-href, data-url, data-link, etc.), non-standard
 * attributes, or dynamically-generated custom elements that aren't <a> tags.
 *
 * @returns {{url: string, label: string}|null}
 */
function extractDlLinkFromAllAttributes() {
  const origin = window.location.origin
  const allEls = document.querySelectorAll('*')
  for (const el of allEls) {
    for (let ai = 0; ai < el.attributes.length; ai++) {
      const attr = el.attributes[ai]
      const val = (attr.value || '').trim()
      if (val.indexOf('/dl/') === -1) continue
      try {
        const parsed = new URL(val, origin)
        if (
          parsed.origin === origin &&
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.pathname.indexOf('/dl/') !== -1
        ) {
          return { url: parsed.href, label: (el.textContent || '').trim() }
        }
      } catch { /* next */ }
    }
  }
  return null
}

/**
 * Browser-side: Check if current page looks like a valid book detail page.
 *
 * @returns {{pathname: string, title: string, looksLikeBookPage: boolean, looksLikeLoginWall: boolean, looksLikeNotFound: boolean}}
 */
function checkNavigationState() {
  const href = window.location.href
  const pathname = window.location.pathname
  const title = (document.title || '').trim()
  const bodyText = (document.body && document.body.innerText || '').slice(0, 200).toLowerCase()
  return {
    href,
    pathname,
    title,
    looksLikeBookPage: /\/book\//.test(pathname),
    looksLikeLoginWall: /login|sign in|sign-in|captcha/.test(bodyText),
    looksLikeNotFound: /not found|404|unavailable|removed/.test(bodyText)
  }
}

/**
 * Browser-side: Find and click the best visible "download menu" button.
 * Uses a scoring system to pick the most relevant visible button.
 *
 * @returns {{clicked: boolean, reason?: string, tag?: string, text?: string}}
 */
function tryClickDownloadMenu() {
  const candidates = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [class*="dots"], [class*="more"], [class*="menu"], [class*="dl"], [class*="download"], [data-testid*="download"], [id*="download"], [id*="dl"]'
  ))

  function visible(el) {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
  }

  function score(el) {
    const text = (el.textContent || '').toLowerCase()
    const cls = String(el.className || '').toLowerCase()
    const aria = String(el.getAttribute('aria-label') || '').toLowerCase()
    const title = String(el.getAttribute('title') || '').toLowerCase()
    const dataAttr = [].map.call(el.attributes, function(a) { return (a.name + ':' + a.value).toLowerCase() }).join(' ')
    const combined = [text, cls, aria, title, dataAttr].join(' ')
    let s = 0
    if (/download/.test(combined)) s += 10
    if (/more|dots|menu|ellipsis|action/.test(combined)) s += 6
    if (/dl\//.test(combined)) s += 10
    if (/format|get |epub|pdf|azw3|mobi/.test(combined)) s += 4
    if (el.tagName === 'BUTTON') s += 3
    if (el.getAttribute('role') === 'button') s += 2
    if (el.tagName === 'A' && (el.getAttribute('href') || '').indexOf('/dl/') !== -1) s += 20
    return s
  }

  const ranked = candidates
    .filter(visible)
    .map(el => ({ el, score: score(el) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  // Gather debug info about all candidates
  const allDebug = candidates.slice(0, 10).map(el => ({
    tag: el.tagName,
    cls: (el.className || '').slice(0, 40),
    text: (el.textContent || '').trim().slice(0, 30)
  }))

  if (!ranked.length) {
    return { clicked: false, reason: 'no_visible_menu', allDebug }
  }

  const target = ranked[0].el
  target.click()
  return {
    clicked: true,
    tag: target.tagName,
    text: (target.textContent || '').trim().slice(0, 80),
    cls: String(target.className || '').slice(0, 120)
  }
}

/**
 * Node-side: Wait for a /dl/ link to appear on the page by polling.
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} timeoutMs
 * @returns {Promise<{url: string, label: string}|null>}
 */
async function waitForDownloadLink(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await page.evaluate(extractDownloadLinkDirect)
    if (result) return result
    try { await page.wait({ time: 100 }) } catch (_) {}
  }
  return null
}

/**
 * Extract download link from the CURRENT page (already navigated to
 * the book detail page). Does NOT do any browser navigation.
 *
 * Side-effect profile:
 *   1. Validates current page is a real book detail page
 *   2. Tries to extract /dl/ link directly (fast path)
 *   3. Clicks the download menu button (scoring-based selector)
 *   4. Polls for /dl/ link to appear (~3s timeout)
 *
 * Throws CommandExecutionError with diagnostic details on failure.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{url: string, format: string|null}|null>}
 */
export async function extractDownloadLinkFromCurrentPage(page) {
  // Fast path: /dl/ links already visible on the page
  const directResult = await page.evaluate(extractDownloadLinkDirect)
  if (directResult) {
    if (!directResult.label) {
      return { url: directResult.url, format: null }
    }
    return { url: directResult.url, format: parseFormatFromLabel(directResult.label) }
  }

  // Click the download menu to reveal /dl/ links
  const clickResult = await page.evaluate(tryClickDownloadMenu)
  if (!clickResult || !clickResult.clicked) {
    failAt('menu_click', '(current page)', {
      reason: clickResult ? clickResult.reason : 'unknown',
      allDebug: clickResult ? clickResult.allDebug : null
    })
  }

  // Poll for /dl/ link to appear (up to 3 seconds)
  const waitedResult = await waitForDownloadLink(page, 3000)
  if (waitedResult) {
    if (!waitedResult.label) {
      return { url: waitedResult.url, format: null }
    }
    return { url: waitedResult.url, format: parseFormatFromLabel(waitedResult.label) }
  }

  // Fallback: scan ALL element attributes for /dl/ URLs (catches data-href,
  // data-url, or any custom attribute that <a> selector might miss)
  const fallbackResult = await page.evaluate(extractDlLinkFromAllAttributes)
  if (fallbackResult) {
    if (!fallbackResult.label) {
      return { url: fallbackResult.url, format: null }
    }
    return { url: fallbackResult.url, format: parseFormatFromLabel(fallbackResult.label) }
  }

  failAt('poll_dl', '(current page)', {
    menuClicked: clickResult.tag + ' ' + clickResult.text,
    waitMs: 3000
  })
}

/**
 * Navigate to a book's detail page, validate page state, and extract
 * the native /dl/ URL and its format.
 *
 * Side-effect profile:
 *   1. Navigates to the book detail page via page.goto('/book/{bookId}')
 *   2. Validates page is a real book detail page (not login wall / 404)
 *   3. Tries to extract /dl/ link directly (fast path)
 *   4. Clicks the download menu button (scoring-based selector)
 *   5. Polls for /dl/ link to appear (~3s timeout)
 *
 * Throws CommandExecutionError with diagnostic details on failure.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} bookId
 * @param {{ timeoutMs?: number, origin?: string, debug?: boolean, targetUrl?: string }} [opts]
 * @returns {Promise<{url: string, format: string|null}|null>}
 */
export async function extractNativeDownloadLink(page, bookId, opts = {}) {
  return extractNativeDownloadLinkInternal(page, bookId, opts)
}

async function extractNativeDownloadLinkInternal(page, bookId, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs)
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 120000

  // -- Real navigation to book detail page --------------------------
  // CDP's Page.navigate requires an absolute URL  -  resolve the relative
  // /book/{id} path against the current page origin.  The caller may pass
  // `opts.origin` (already known from an earlier evaluate) to avoid an
  // extra round-trip, or `opts.targetUrl` (from booklist API response) to
  // use the slug-based URL instead of constructing from numeric bookId.
  let targetUrl
  if (opts.targetUrl) {
    // Support cross-origin book URLs from imported/exported booklists:
    // strip old origin, resolve path against current page origin.
    const origin = opts.origin || (await page.evaluate(() => window.location.origin)) || ''
    try {
      const parsed = new URL(String(opts.targetUrl))
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (parsed.origin !== origin) {
          // Cross-origin book URL — strip old origin, use path on current site
          targetUrl = origin.replace(/\/$/, '') + parsed.pathname
          console.warn('[booklist-download]', JSON.stringify({
            phase: 'navigate_book_cross_origin',
            bookId,
            originalUrl: opts.targetUrl,
            resolvedUrl: targetUrl,
          }))
        } else {
          targetUrl = opts.targetUrl
        }
      } else {
        targetUrl = opts.targetUrl
      }
    } catch {
      targetUrl = opts.targetUrl
    }
  } else {
    const targetPath = '/book/' + encodeURIComponent(bookId)
    const origin = opts.origin || (await page.evaluate(() => window.location.origin)) || ''
    targetUrl = origin.replace(/\/$/, '') + targetPath
  }

  // Debug: log current page state before navigation
  if (opts.debug) {
    const beforeUrl = await page.evaluate('window.location.href')
    const beforeOrigin = await page.evaluate('window.location.origin')
    process.stderr.write(`[cdp-nav] book=${bookId} currentUrl="${beforeUrl}" currentOrigin="${beforeOrigin}" targetUrl="${targetUrl}"\n`)
    if (beforeUrl === targetUrl) {
      process.stderr.write(`[cdp-nav] ⚠️ targetUrl equals currentUrl  -  will refresh instead of navigate!\n`)
    }
  }

  const navStart = Date.now()
  console.warn('[booklist-download]', JSON.stringify({ phase: 'navigate_book', bookId, elapsedMs: 0, targetUrl }))

  try {
    await page.goto(targetUrl, {
      waitUntil: 'load',
      settleMs: 2000,
      timeout: safeTimeoutMs,
    })
    console.warn('[booklist-download]', JSON.stringify({ phase: 'navigate_book_goto', bookId, elapsedMs: Date.now() - navStart, targetUrl }))
  } catch (error) {
    failAt('nav', bookId, {
      error: error instanceof Error ? error.message : String(error),
      targetUrl,
      timeoutMs: safeTimeoutMs,
    })
  }

  // Debug: log page state after navigation
  if (opts.debug) {
    const afterUrl = await page.evaluate('window.location.href')
    process.stderr.write(`[cdp-nav] book=${bookId} afterGotoUrl="${afterUrl}"\n`)
  }

  const navState = await page.evaluate(checkNavigationState)
  if (opts.debug) {
    process.stderr.write(`[cdp-nav] book=${bookId} navState=${JSON.stringify(navState)}\n`)
  }
  console.warn('[booklist-download]', JSON.stringify({
    phase: 'navigate_book_nav_state',
    bookId,
    elapsedMs: Date.now() - navStart,
    looksLikeBookPage: Boolean(navState && navState.looksLikeBookPage),
    pathname: navState && typeof navState.pathname === 'string' ? navState.pathname : '',
    title: navState && typeof navState.title === 'string' ? navState.title.slice(0, 100) : '',
    href: navState && typeof navState.href === 'string' ? navState.href.slice(0, 200) : '',
  }))

  if (!navState.looksLikeBookPage) {
    const currentState = await page.evaluate(checkNavigationState)

    failAt('nav', bookId, {
      error: currentState.looksLikeLoginWall ? 'login_wall' :
             currentState.looksLikeNotFound ? 'not_found' : 'not_book_page',
      pathname: currentState.pathname,
      title: currentState.title,
      href: currentState.href,
      targetUrl,
    })
  }

  // Fast path: /dl/ links already visible on the page
  const directResult = await page.evaluate(extractDownloadLinkDirect)
  if (directResult) {
    if (!directResult.label) {
      return { url: directResult.url, format: null }
    }
    return { url: directResult.url, format: parseFormatFromLabel(directResult.label) }
  }

  // Click the download menu to reveal /dl/ links
  const clickResult = await page.evaluate(tryClickDownloadMenu)
  if (!clickResult || !clickResult.clicked) {
    failAt('menu_click', bookId, {
      reason: clickResult ? clickResult.reason : 'unknown',
      allDebug: clickResult ? clickResult.allDebug : null
    })
  }

  // Poll for /dl/ link to appear (up to 3 seconds)
  const waitedResult = await waitForDownloadLink(page, 3000)
  if (waitedResult) {
    if (!waitedResult.label) {
      return { url: waitedResult.url, format: null }
    }
    return { url: waitedResult.url, format: parseFormatFromLabel(waitedResult.label) }
  }

  // Fallback: scan ALL element attributes for /dl/ URLs before failing
  const fallbackResult = await page.evaluate(extractDlLinkFromAllAttributes)
  if (fallbackResult) {
    if (!fallbackResult.label) {
      return { url: fallbackResult.url, format: null }
    }
    return { url: fallbackResult.url, format: parseFormatFromLabel(fallbackResult.label) }
  }

  failAt('poll_dl', bookId, {
    menuClicked: clickResult.tag + ' ' + clickResult.text,
    waitMs: 3000
  })
}

/**
 * Parse a file format from a download link label (e.g. "PDF, 2.39 MB" → "pdf").
 *
 * Strategy:
 *   1. Try the first alphanumeric word in the label
 *   2. If the first word is not in the known allowlist, scan the entire label
 *   3. Return null if no match found
 *
 * @param {string} label - Link text (e.g. "PDF, 2.39 MB" or "(PDF) 2.3 MB")
 * @returns {string|null} - Lower-cased format or null
 */
export function parseFormatFromLabel(label) {
  if (!label) return null

  const lowerLabel = label.toLowerCase();

  // Build allowlist regex from DOWNLOAD_FORMATS (single source of truth).
  const formatPattern = DOWNLOAD_FORMATS.join('|')
  const FIRST_WORD_ALLOWED = new RegExp('^(' + formatPattern + ')$', 'i')

  const firstWord = (label.match(/^([a-zA-Z0-9]+)/) || [])[1];
  if (firstWord && FIRST_WORD_ALLOWED.test(firstWord)) {
    return firstWord.toLowerCase();
  }

  for (const ext of DOWNLOAD_FORMATS) {
    const wordBound = new RegExp('\\b' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (wordBound.test(lowerLabel)) {
      return ext;
    }
  }

  return null;
}
