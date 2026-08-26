/**
 * Shared book detail enrichment for Z-Library Desktop commands.
 *
 * Navigates to a book's detail page and extracts full metadata (publisher,
 * series, categories, MD5, etc.).
 *
 * Callers receive raw metadata and merge fields themselves:
 *   - `booklist-export.js` merges camelCase keys directly
 *   - `search.js` normalizes keys to kebab-case via normalizeOutputKeys before merging
 *
 * This avoids duplicating the navigate → extract → handle-error flow.
 */

import { assertSameOriginHttpUrl, assertSameOriginNotLoginWall } from './url-boundary.js'
import { buildBookPageMetadata } from '../book-metadata.js'
import { extractDownloadLinkFromCurrentPage } from '../download/link.js'
import { extractBookMd5 } from './md5-format.js'

/**
 * Navigate to a book's detail page and extract enriched metadata.
 *
 * Returns the extracted metadata + any download link found. On failure,
 * returns { error: '...' } with no metadata — caller sets detail-error on the row.
 *
 * Side-effect profile:
 *   1. Validates book URL is same-origin HTTP(S) (returns error on failure)
 *   2. Navigates to the detail page via page.goto
 *   3. Waits for page settle (1s)
 *   4. Verifies navigation didn't hit a login wall
 *   5. Extracts metadata (buildBookPageMetadata) and download link in parallel
 *   6. Extracts MD5 from the download link
 *   7. Catches errors and returns { error: '...' } instead of throwing
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {{ url: string }} row  -  book row with at least url
 * @param {{ origin: URL, commandName: string }} options  -  validated page origin (URL object) and command name for error attribution
 * @returns {Promise<{ metadata?: Record<string, unknown>, error?: string }>}
 */
export async function enrichBookRowFromDetailPage (page, row, { origin, commandName }) {
  if (!row || !row.url) {
    return { error: 'no url' }
  }

  try {
    const detailUrl = assertSameOriginHttpUrl(row.url, origin.origin, 'detail URL')
    await page.goto(detailUrl, { waitUntil: 'load', settleMs: 2000, timeout: 15_000 })
    await page.wait(1)
    await assertSameOriginNotLoginWall(page, origin, commandName)

    const [metadata, dlResult] = await Promise.all([
      buildBookPageMetadata(page),
      extractDownloadLinkFromCurrentPage(page).catch(function () { return null }),
    ])

    const detailMd5 = await extractBookMd5(page, {
      downloadUrl: dlResult?.url,
    })
    if (detailMd5) metadata.md5 = detailMd5

    return { metadata }
  } catch (err) {
    return { error: err.message || String(err) }
  }
}
