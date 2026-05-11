/**
 * Z-Library adapter utilities.
 */

import { ArgumentError } from '@jackwener/opencli/errors';

const ZLIBRARY_DOMAIN = 'z-library.im';
const ZLIBRARY_ORIGIN = `https://${ZLIBRARY_DOMAIN}`;
const ZLIBRARY_ALLOWED_HOSTS = new Set([
  ZLIBRARY_DOMAIN,
  `www.${ZLIBRARY_DOMAIN}`,
]);

export function normalizeZlibraryBookUrl(input) {
  const raw = String(input || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ArgumentError('Z-Library book URL must be a valid http(s) URL', `Example: ${ZLIBRARY_ORIGIN}/book/...`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !ZLIBRARY_ALLOWED_HOSTS.has(url.hostname)) {
    throw new ArgumentError(
      `Unsupported Z-Library URL host: ${url.hostname}`,
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

/**
 * Extract book title from page context.
 * Tries z-bookcard shadow DOM first, then falls back to page title.
 */
export async function extractBookTitle(page) {
  const title = await page.evaluate(`
      (() => {
        const card = document.querySelector('z-bookcard');
        if (card && card.shadowRoot) {
          const el = card.shadowRoot.querySelector('[class*="title"], h1, a');
          if (el) return el.textContent.trim().split('\\n')[0].trim();
        }
        return document.title.replace(/\\s*[-|].*$/, '').trim();
      })()
    `);
  return String(title || '').trim();
}

/**
 * Extract available download formats from book page.
 * Clicks the three-dot menu to reveal download options.
 * NOTE: Z-Library download links redirect through /dl/<hash> URLs.
 * These require browser cookies and may not produce direct file downloads
 * in OpenCLI's browser automation. For actual file downloading,
 * consider using Playwright's download event handling instead.
 */
export async function extractFormats(page) {
  // Click three-dot menu if present
  await page.evaluate(`
      (() => {
        const btn = document.querySelector(
          'button[aria-label*="more" i], [class*="dots" i], [class*="more" i]'
        );
        if (btn) btn.click();
      })()
    `);
  // Wait for menu
  await page.wait({ time: 3 });

  const formats = await page.evaluate(`
      JSON.stringify((() => {
        const res = { pdf: '', epub: '' };
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.href || '';
          const t = (a.textContent || '').toUpperCase();
          if (h.includes('/dl/') && t.includes('PDF')) res.pdf = h;
          if (h.includes('/dl/') && t.includes('EPUB')) res.epub = h;
        });
        return res;
      })())
    `);
  return JSON.parse(formats);
}

/**
 * Extract book cards from search results page.
 *
 * Z-Library renders search results as <z-bookcard> custom elements.
 * Each card contains the book title, author, and a link to the book page.
 * The link is inside a shadow DOM that can be queried with card.shadowRoot.
 *
 * This approach was validated on 2026-04-28 against z-library.im.
 */
export async function extractSearchResults(page, limit) {
  const raw = await page.evaluate(`
    JSON.stringify(
      Array.from(document.querySelectorAll('z-bookcard'))
        .slice(0, ${limit})
        .map((card, index) => {
          const text = card.textContent.trim();
          const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
          const title = lines[0] || '';
          const author = lines[1] || '';
          let url = '';
          try {
            if (card.shadowRoot) {
              const link = card.shadowRoot.querySelector('a');
              if (link) url = link.href || '';
            }
          } catch(e) {}
          return { rank: index + 1, title, author, url };
        })
        .filter(item => item.url && item.title)
    )
  `);

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export { ZLIBRARY_DOMAIN, ZLIBRARY_ORIGIN };
