/**
 * Shared DOM extraction utilities for Z-Library.
 *
 * Functions here are used by both clis/zlibrary/ (web adapter) and
 * clis/zlibrary-app/ (desktop app adapter).
 */
import { evaluateJson, normalizeStringRecord } from '../_shared/browser-utils.js'
import { CANONICAL_LANGUAGES, LANGUAGE_BY_CODE, LANGUAGE_CODE_BY_NAME, LANGS } from './_shared/languages.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXTS = ['pdf', 'epub', 'azw3', 'mobi', 'zip', 'azw', 'djvu', 'txt']
export const CONTENT_TYPES = ['book', 'article', 'magazine', 'thesis']

// Re-export for downstream consumers
export { LANGS, LANGUAGE_BY_CODE, LANGUAGE_CODE_BY_NAME, CANONICAL_LANGUAGES as LANGUAGES }

const FULL_LANG_NAMES = new Set(
  CANONICAL_LANGUAGES.map(function (l) { return l.name.toLowerCase() })
)

/** Default results limit when none specified. */
const DEFAULT_RESULTS_LIMIT = 50
/** Hard maximum — prevents browser-side overflow. */
const MAX_RESULTS_LIMIT = 100
/** Fallback shape when format extraction returns unexpected data. */
const EMPTY_FORMATS = { pdf: '', epub: '', azw3: '', mobi: '' }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Format bytes to a human-readable string (e.g. 1024 → "1.0 KB").
 *
 * @param {number} bytes
 * @returns {string}
 */
export function fmtBytes (bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const scaledBytes = bytes / 1024 ** unitIndex
  return `${scaledBytes.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Check whether `lang` is a recognised Z-Library language code.
 *
 * @param {string|null|undefined} lang
 * @returns {boolean}
 */
export function validateLanguage (lang) {
  if (!lang) return false
  return LANGS.includes(String(lang).toLowerCase())
}

/**
 * Check whether `name` is a recognised full language display name (case-insensitive).
 * Covers English, Japanese, Chinese, French, German, Spanish, Russian, etc.
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function validateLanguageName (name) {
  return Boolean(name) && FULL_LANG_NAMES.has(String(name).toLowerCase())
}

/**
 * Check whether `ext` is a recognised book file extension (case-insensitive).
 *
 * @param {string|null|undefined} ext
 * @returns {boolean}
 */
export function validateExtension (ext) {
  return Boolean(ext) && EXTS.includes(String(ext).toLowerCase())
}

/**
 * Check whether `type` is a recognised Z-Library content type.
 *
 * @param {string|null|undefined} type
 * @returns {boolean}
 */
export function validateContentType (type) {
  return Boolean(type) && CONTENT_TYPES.includes(String(type).toLowerCase())
}

/**
 * Lookup language code by display name (case-insensitive).
 * @param {string} name
 * @returns {string}
 */
export function languageCodeByName (name) {
  return LANGUAGE_CODE_BY_NAME.get(String(name).toLowerCase()) || ''
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — module-private)
// ---------------------------------------------------------------------------

/**
 * Clamp results limit to a safe integer range [1, MAX_RESULTS_LIMIT],
 * with a default of DEFAULT_RESULTS_LIMIT.
 * Prevents script injection and NaN/undefined corruption in evaluate strings.
 *
 * @param {unknown} input
 * @returns {number}
 */
function clampResultsLimit (input) {
  const parsed = Number(input)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RESULTS_LIMIT
  return Math.min(Math.round(parsed), MAX_RESULTS_LIMIT)
}

/**
 * Normalise an unknown format-extraction result into the guaranteed shape.
 *
 * @param {unknown} value
 * @returns {{pdf: string, epub: string, azw3: string, mobi: string}}
 */
function normalizeFormats (value) {
  return normalizeStringRecord(value, EMPTY_FORMATS)
}

// ---------------------------------------------------------------------------
// Page-dependent DOM extractors
// ---------------------------------------------------------------------------

/**
 * Extract book title from page context.
 * Tries z-bookcard shadow DOM first, then z-cover attribute,
 * then falls back to page title.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}
 */
export async function extractBookTitle (page) {
  const title = await page.evaluate(`
    (() => {
      const card = document.querySelector('z-bookcard');
      const titleElement = card?.shadowRoot?.querySelector('[class*="title"], h1, a');
      const shadowTitle = titleElement?.textContent?.trim().split('\\n')[0].trim();
      if (shadowTitle) return shadowTitle;

      // Fallback: z-bookcard HTML attribute (canonical source on search + detail pages)
      var cardTitle = card?.getAttribute('title')?.trim();
      if (cardTitle) return cardTitle;

      // Fallback for detail pages without z-bookcard (zlibrary-app adapter)
      var cover = document.querySelector('z-cover');
      var coverTitle = cover?.getAttribute('title')?.trim();
      if (coverTitle) return coverTitle;

      return document.title.replace(/\\s*[-|].*$/, '').trim();
    })()
  `)
  return String(title || '').trim()
}

/**
 * Extract book author from page context.
 * Tries z-bookcard attribute first, then shadow DOM text fallback.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}
 */
export async function extractBookAuthor (page) {
  const author = await page.evaluate(`
    (() => {
      const card = document.querySelector('z-bookcard');
      const attrAuthor = card?.getAttribute('author')?.trim();
      if (attrAuthor) return attrAuthor;

      const authorElement = card?.shadowRoot?.querySelector('[class*="author"], [itemprop="author"], a[href*="/author/"]');
      const shadowAuthor = authorElement?.textContent?.trim().split('\\n')[0].trim();
      if (shadowAuthor) return shadowAuthor;

      const text = (card?.textContent || '').trim();
      const lines = text.split('\\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length > 1 && lines[1]) return lines[1];

      // Fallback for detail pages without z-bookcard (zlibrary-app adapter)
      var cover = document.querySelector('z-cover');
      var coverAuthor = cover?.getAttribute('author')?.trim();
      if (coverAuthor) return coverAuthor;

      var authorEl = document.querySelector('i.authors');
      if (authorEl) {
        var authorLinks = authorEl.querySelectorAll('a');
        var authorParts = [];
        for (var ai = 0; ai < authorLinks.length; ai++) {
          var t = (authorLinks[ai].textContent || '').trim();
          if (t) authorParts.push(t);
        }
        if (authorParts.length) return authorParts.join(', ');
      }

      // Label-scanning: find author-related label/value pairs across the page
      var authorLabels = ['author', 'author:', 'by', 'by:', '作者', '作者:', '著者', '著者:', '原著者', '原著者:', 'автор', 'автор:', 'auteur', 'auteur:'];
      var allEls = document.querySelectorAll('div, span, th, dt, li, p, td');
      for (var ei = 0; ei < allEls.length; ei++) {
        var el = allEls[ei];
        var raw = (el.textContent || '').trim();
        var lower = raw.toLowerCase().replace(/[:;]$/, '');
        if (!lower) continue;
        for (var li = 0; li < authorLabels.length; li++) {
          var label = authorLabels[li];
          if (lower === label || lower.startsWith(label + ':') || lower.startsWith(label + ';') || lower.startsWith(label + '：')) {
            // Inline (<li>Author: John Doe</li>)
            var inline = raw.replace(/^[^:：;]*[:：;]\\s*/, '').trim();
            if (inline && inline !== raw) return inline;
            // Next sibling (<td>Author</td><td>John Doe</td>)
            var next = el.nextElementSibling;
            if (next && next.textContent) {
              var nextText = (next.textContent || '').trim();
              if (nextText) return nextText;
            }
            // Parent's next sibling (<tr><td>Author</td></tr><tr><td>John Doe</td></tr>)
            if (el.parentElement) {
              var parentNext = el.parentElement.nextElementSibling;
              if (parentNext && parentNext.textContent) {
                var parentNextText = (parentNext.textContent || '').trim();
                if (parentNextText) return parentNextText;
              }
            }
          }
        }
      }

      const meta = document.querySelector('meta[name="description"]');
      const metaContent = meta?.getAttribute('content') || '';
      const fromMeta = metaContent.match(/(?:by|author|автор)\s*:?\s*([^,.]+)/i);
      if (fromMeta && fromMeta[1]) return fromMeta[1].trim();

      return '';
    })()
  `)
  return String(author || '').trim()
}

/**
 * Extract book language display name from page context.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}
 */
export async function extractBookLanguage (page) {
  const language = await page.evaluate(`
    (() => {
      const card = document.querySelector('z-bookcard');
      const attrLanguage = card?.getAttribute('language')?.trim();
      if (attrLanguage) return attrLanguage;

      const text = (card?.textContent || '').trim();
      const lines = text.split('\\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length > 2 && lines[2]) return lines[2];

      const allEls = document.querySelectorAll('div, span, th, dt, li, p, td');
      const labels = ['language', 'language:', '语言', '语言:', '語言', '語言:', 'langue', 'langue:', 'idioma', 'idioma:'];
      for (const el of allEls) {
        const raw = (el.textContent || '').trim();
        const lower = raw.toLowerCase();
        for (const label of labels) {
          if (lower === label || lower.startsWith(label)) {
            const inline = raw.replace(/^[^:：]*[:：]\\s*/, '').trim();
            if (inline && inline !== raw) return inline;
            const next = el.nextElementSibling;
            if (next?.textContent?.trim()) return next.textContent.trim();
          }
        }
      }

      const meta = document.querySelector('meta[name="description"]');
      const metaContent = meta?.getAttribute('content') || '';
      const langMatch = metaContent.match(/\\((\\w+)\\)/);
      if (langMatch && langMatch[1]) return langMatch[1];

      return '';
    })()
  `)
  const trimmed = String(language || '').trim()
  // Validate against known language names — reject garbage (categories, titles, HTML dumps)
  if (trimmed && FULL_LANG_NAMES.has(trimmed.toLowerCase())) {
    return trimmed
  }
  return ''
}

/**
 * Extract format quality rating from page context.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}
 */
export async function extractBookFormatQualityRating (page) {
  const quality = await page.evaluate(`
    (() => {
      const card = document.querySelector('z-bookcard');
      const value = card?.getAttribute('quality')?.trim();
      if (value && value !== '0.0' && value !== '0') return value;
      if (value === '0' || value === '0.0') return 'NA';

      // Fallback: scan for quality/rating labels across the page
      var qualityLabels = ['quality', 'quality:', 'rating', 'rating:', '评分', '评分:', '质量', '质量:', '格式质量', '格式质量:'];
      var allEls = document.querySelectorAll('div, span, th, dt, li, p, td');
      for (var ei = 0; ei < allEls.length; ei++) {
        var el = allEls[ei];
        var raw = (el.textContent || '').trim();
        var lower = raw.toLowerCase().replace(/[:;]$/, '');
        if (!lower) continue;
        for (var li = 0; li < qualityLabels.length; li++) {
          var label = qualityLabels[li];
          if (lower === label || lower.startsWith(label + ':') || lower.startsWith(label + ';') || lower.startsWith(label + '：')) {
            // Inline (<li>Quality: 5.0</li>)
            var inline = raw.replace(/^[^:：;]*[:：;]\\s*/, '').trim();
            var inlineNum = inline.match(/^(\\d+(?:\\.\\d+)?)/);
            if (inlineNum && inlineNum[1]) return inlineNum[1];
            // Next sibling (<td>Quality</td><td>5.0</td>)
            var next = el.nextElementSibling;
            if (next && next.textContent) {
              var nextText = (next.textContent || '').trim();
              var nextNum = nextText.match(/^(\\d+(?:\\.\\d+)?)/);
              if (nextNum && nextNum[1]) return nextNum[1];
            }
            // Parent's next sibling
            if (el.parentElement) {
              var parentNext = el.parentElement.nextElementSibling;
              if (parentNext && parentNext.textContent) {
                var pnText = (parentNext.textContent || '').trim();
                var pnNum = pnText.match(/^(\\d+(?:\\.\\d+)?)/);
                if (pnNum && pnNum[1]) return pnNum[1];
              }
            }
          }
        }
      }

      // Fallback: check for star-based rating elements
      var starred = document.querySelectorAll('[class*="star"], [class*="rating"], [class*="quality"]');
      for (var si = 0; si < starred.length; si++) {
        var starText = (starred[si].textContent || '').trim();
        var starNum = starText.match(/^(\\d+(?:\\.\\d+)?)\\s*[★☆\\*]/);
        if (starNum && starNum[1]) return starNum[1];
        var starInner = starText.match(/^[★☆\\*]+\\s*(\\d+(?:\\.\\d+)?)/);
        if (starInner && starInner[1]) return starInner[1];
      }

      // Fallback: check for .book-rating-quality-score (detail page without z-bookcard)
      // Class "none" indicates no rating available — treat as NA.
      var scoreEl = document.querySelector('.book-rating-quality-score');
      if (scoreEl) {
        if (scoreEl.classList.contains('none')) return 'NA';
        var scoreText = (scoreEl.textContent || '').trim();
        var scoreNum = scoreText.match(/^(\\d+(?:\\.\\d+)?)/);
        if (scoreNum && scoreNum[1]) return scoreNum[1];
      }

      return '';
    })()
  `)
  return String(quality || '').trim()
}

/**
 * Extract all z-bookcard attributes from a single book detail page.
 *
 * Reads the same attributes that {@link extractSearchResults} reads per card,
 * plus standard book metadata fields. Unlike the individual extractors
 * (extractBookTitle, extractBookAuthor, etc.), this reads raw z-bookcard
 * HTML attributes only — no fallback parsing. Callers should merge with
 * the individual extractors for fallback coverage.
 *
 * Returns empty strings for missing attributes rather than null/undefined.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{bookId: string, title: string, author: string, year: string, language: string, extension: string, filesize: string, rating: string, quality: string, publisher: string, isbn: string, href: string, md5: string}>}
 */
/** Attribute keys read from z-bookcard / z-cover elements, in output order. */
const BOOK_CARD_ATTR_KEYS = [
  'bookId', 'title', 'author', 'year', 'language', 'extension', 'filesize',
  'rating', 'quality', 'publisher', 'isbn', 'href', 'md5'
]

/** DOM attribute name for each output key (bookId reads the 'id' attribute). */
const BOOK_CARD_SOURCE_ATTRS = {}
for (const key of BOOK_CARD_ATTR_KEYS) {
  BOOK_CARD_SOURCE_ATTRS[key] = key === 'bookId' ? 'id' : key
}

/**
 * Build a normalized all-strings record with empty-string defaults.
 *
 * @param {object|null} raw
 * @returns {Record<string, string>}
 */
function normalizeBookCardAttrs (raw) {
  const out = {}
  for (const key of BOOK_CARD_ATTR_KEYS) {
    out[key] = String((raw && raw[key]) || '')
  }
  return out
}

export async function extractBookCardAttributes (page) {
  const raw = await evaluateJson(page, `
    return (() => {
      var el = document.querySelector('z-bookcard') || document.querySelector('z-cover');
      if (!el) return {};
      var get = function(attr) {
        var v = el.getAttribute(attr);
        return (v && v.trim()) || '';
      };
      var result = {};
      var keys = ${JSON.stringify(BOOK_CARD_ATTR_KEYS)};
      var sources = ${JSON.stringify(BOOK_CARD_SOURCE_ATTRS)};
      for (var i = 0; i < keys.length; i++) {
        result[keys[i]] = get(sources[keys[i]]);
      }
      // NOTE: meta[name="propeller"] fallback was REMOVED (2026-06) — it's a
      // constant site token (49c350d5...), not the book's content MD5.
      // DO NOT re-add. See OBSOLETED spec in .trellis/spec/backend/opencli-shared-dom.md
      return result;
    })()
  `, null)

  if (!raw || typeof raw !== 'object') {
    return normalizeBookCardAttrs(null)
  }
  return normalizeBookCardAttrs(raw)
}

/**
 * Extract MD5 hash from a /dl/ link on a book detail page.
 *
 * First tries direct DOM links (fast path). If none found, clicks the
 * download menu button to reveal links, then polls briefly. Returns
 * empty string if no /dl/ link's URL contains an MD5 hash.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<string>}
 */
export async function extractDownloadMd5 (page) {
  // Shared helper: extract MD5 from first /dl/ link found in DOM
  // (used in both fast-path and poll-path)
  const FIND_DL_MD5 = `
    (() => {
      var links = document.querySelectorAll('a[href*="/dl/"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || links[i].href || '';
        var m = href.match(/\\/dl\\/([a-f0-9]{32})/i);
        if (m) return m[1];
      }
      return '';
    })()
  `

  // Fast path: look for direct /dl/ links in the DOM
  const md5 = await page.evaluate(FIND_DL_MD5)
  if (md5) return String(md5).trim()

  // Slow path: click the download menu using scoring (matching tryClickDownloadMenu),
  // then poll for /dl/ links to appear.
  const clicked = await page.evaluate(`
    (() => {
      var candidates = Array.from(document.querySelectorAll(
        'button, a, [role="button"], [class*="dots"], [class*="more"], [class*="menu"]'
      ));
      var visible = candidates.filter(function(el) {
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
          style.visibility !== 'hidden' && style.display !== 'none';
      });
      var best = null, bestScore = 0;
      for (var i = 0; i < visible.length; i++) {
        var el = visible[i];
        var text = (el.textContent || '').toLowerCase();
        var cls = String(el.className || '').toLowerCase();
        var aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        var title = String(el.getAttribute('title') || '').toLowerCase();
        var combined = [text, cls, aria, title].join(' ');
        var s = 0;
        if (/download/.test(combined)) s += 10;
        if (/more|dots|menu|ellipsis|action/.test(combined)) s += 6;
        if (el.tagName === 'BUTTON') s += 3;
        if (el.getAttribute('role') === 'button') s += 2;
        if (s > bestScore) { bestScore = s; best = el; }
      }
      if (best) { best.click(); return true; }
      return false;
    })()
  `)
  if (!clicked) return ''

  // Poll for /dl/ links to appear (up to 5 seconds)
  var deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await page.wait(0.5)
    const md5After = await page.evaluate(FIND_DL_MD5)
    if (md5After) return String(md5After).trim()
  }
  return ''
}

/**
 * Extract available download formats from book page.
 * Clicks the three-dot menu to reveal download options.
 *
 * NOTE: Z-Library download links redirect through /dl/<hash> URLs.
 * These require browser cookies and may not produce direct file downloads
 * in OpenCLI's browser automation. For actual file downloading,
 * consider using Playwright's download event handling instead.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{pdf: string, epub: string, azw3: string, mobi: string}>}
 */
export async function extractFormats (page) {
  // Click three-dot menu to reveal download options
  await page.evaluate(`
    (() => {
      const menuButton = document.querySelector(
        '[class*="dots" i], [class*="more" i]'
      );
      if (menuButton) menuButton.click();
    })()
  `)
  // Wait for menu animation
  await page.wait({ time: 3 })

  // Extract format links.
  // URLs are resolved to absolute same-origin HTTP(S) URLs inside the
  // evaluate script before crossing the CDP boundary. Relative formats
  // like /dl/pdf are resolved against window.location.origin.
  const result = await evaluateJson(page, `
    const formats = { pdf: '', epub: '', azw3: '', mobi: '' };
    const origin = window.location.origin;
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.href || '';
      if (!href.includes('/dl/')) continue;
      // Resolve to absolute same-origin HTTP(S) URL
      try {
        const parsed = new URL(href, origin);
        if (parsed.origin === origin &&
            (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
          const label = (link.textContent || '').toUpperCase();
          if (label.includes('PDF')) formats.pdf = parsed.href;
          if (label.includes('EPUB')) formats.epub = parsed.href;
          if (label.includes('AZW3')) formats.azw3 = parsed.href;
          if (label.includes('MOBI')) formats.mobi = parsed.href;
        }
      } catch (e) {
        // Skip unparseable URLs
      }
    }
    return formats;
  `, null)

  return normalizeFormats(result)
}

/**
 * Extract book cards from search results page.
 *
 * Z-Library renders search results as <z-bookcard> custom elements.
 * Metadata is split between projected slot text and HTML attributes:
 * title/author are rendered as slot text, while year/language/extension/etc.
 * are available as attributes. Content type is inferred from the parent
 * container's class name.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {number} limit
 * @returns {Promise<Array<{rank: number, title: string, author: string, year: string, language: string, extension: string, contentType: string, size: string, url: string, id: string, qualityRating: string|null, formatQualityRating: string|null, favorite: boolean, booklist: boolean, downloaded: boolean}>>}
 */
export async function extractSearchResults (page, limit) {
  const maxResults = clampResultsLimit(limit)

  return evaluateJson(page, `
    return Array.from(document.querySelectorAll('z-bookcard'))
      .slice(0, ${JSON.stringify(maxResults)})
      .map((card, index) => {
        const text = (card.textContent || '').trim();
        const lines = text.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);

        const title = lines[0] || '';
        const author = lines.length > 1 ? lines[1] : '';
        const year = card.getAttribute('year') || (lines.find(function(l) { return /^(19\\d{2}|20[0-2]\\d)$/.test(l); }) || '');
        const language = card.getAttribute('language') || '';
        const extension = card.getAttribute('extension') || '';
        const size = card.getAttribute('filesize') || '';
        const id = card.getAttribute('id') || '';

        let parentClassName = '';
        try { parentClassName = card.parentElement.className || ''; } catch {}
        const contentType = card.getAttribute('data-type') ||
          (parentClassName.includes('resItemBoxBooks') ? 'book' :
           parentClassName.includes('resItemBoxArticles') ? 'article' : '');

        let url = '';
        const toAbsoluteUrl = function(href) {
          if (!href) return '';
          try {
            const parsed = new URL(href, window.location.href);
            if (parsed.origin !== window.location.origin) return '';
            return parsed.href;
          } catch {
            if (href.startsWith('/')) return window.location.origin + href;
            return '';
          }
        };
        try {
          if (card.shadowRoot) {
            const link = card.shadowRoot.querySelector('a');
            if (link) url = toAbsoluteUrl(link.href || '');
          }
        } catch {}
        if (!url) url = toAbsoluteUrl(card.getAttribute('href') || '');

        // Quality ratings — card.getAttribute returns string or null.
        // '0' or '0.0' means no rating available (site convention) — use 'NA'.
        const rawRating = card.getAttribute('rating');
        const qualityRating = rawRating && rawRating !== '0.0' && rawRating !== '0' ? rawRating : 'NA';
        const rawQuality = card.getAttribute('quality');
        const formatQualityRating = rawQuality && rawQuality !== '0.0' && rawQuality !== '0' ? rawQuality : 'NA';

        // Boolean flags — extracted from the DOM when logged in, default false otherwise.
        const favorite = card.getAttribute('favorite') === 'true' ||
          !!(card.shadowRoot && card.shadowRoot.querySelector('.actions .like.zlibicon-heart-fill'));
        const booklist = card.getAttribute('booklisted') === 'true' ||
          !!(card.shadowRoot && card.shadowRoot.querySelector('.actions .bookmark.zlibicon-flag-fill'));
        let downloaded = false;
        try {
          const cover = card.shadowRoot && card.shadowRoot.querySelector('z-cover');
          if (cover && cover.shadowRoot) {
            downloaded = !!cover.shadowRoot.querySelector('.mark.downloaded');
          }
        } catch {}

        // Publisher and ISBN — available as card attributes on search results
        const publisher = card.getAttribute('publisher') || '';
        const isbn = card.getAttribute('isbn') || '';
        // MD5 from z-bookcard attribute only (other sources are untrusted)
        let md5 = card.getAttribute('md5') || '';

        return { rank: index + 1, title: title, author: author, year: year, language: language, extension: extension, contentType: contentType, size: size, url: url, id: id, qualityRating: qualityRating, formatQualityRating: formatQualityRating, favorite: favorite, booklist: booklist, downloaded: downloaded, publisher: publisher, isbn: isbn, md5: md5 };
      })
      .filter(function(result) { return result.url && result.title; });
  `, [])
}

/**
 * Extract detail-page-only attributes from a book detail page.
 *
 * Must be called when the page is already navigated to a book detail page
 * (`/book/<id>`). Uses label-scanning heuristics to find metadata pairs
 * outside the <z-bookcard> element — fields like pages, ISBN-10, ISBN-13,
 * series, volume, categories, and description.
 *
 * The returned object has empty-string defaults for every field so callers
 * can merge it unconditionally without null checks.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{publisher: string, isbn: string, pages: string, isbn10: string, isbn13: string, series: string, volume: string, categories: string, description: string, metaDescription: string, year: string, language: string, extension: string, filesize: string, rating: string, mainFormat: string, quality: string}>}
 */
const DEFAULT_DETAIL_ATTRS = {
  publisher: '',
  isbn: '',
  pages: '',
  isbn10: '',
  isbn13: '',
  series: '',
  volume: '',
  categories: '',
  description: '',
  metaDescription: '',
  year: '',
  language: '',
  extension: '',
  filesize: '',
  mainFormat: '',
  quality: '',
  rating: ''
}

export async function extractBookDetailAttributes (page) {
  const raw = await evaluateJson(page, `
    var card = document.querySelector('z-bookcard');
    var cardPublisher = card ? (card.getAttribute('publisher') || '') : '';
    var cardIsbn = card ? (card.getAttribute('isbn') || '') : '';

    var result = { publisher: '', isbn: '', pages: '', isbn10: '', isbn13: '', series: '', volume: '', categories: '', description: '', metaDescription: '' };

    // -- 1. Label-scanning — find label/value pairs by text content --
    // Z-Library detail pages use various structures: <tr><td>label<td>value,
    // <div class="prop"><span>label</span><span>value</span>, or simple
    // text patterns. We scan every element for known label text and read
    // the value from inline content first, then the next sibling, then
    // the parent's next sibling.
    // Inline pattern (<li>Pages: 350</li>) is the most common on Z-Library.
    var LABEL_MAP = {
      publisher: ['publisher', 'published by', 'publishing house', 'imprint', '出版社', '出版者'],
      pages: ['pages', 'page count', 'number of pages', '頁數', '页数', '页码'],
      isbn: ['isbn', 'isbn number', 'isbn編號', 'isbn编号'],
      'isbn10': ['isbn-10', 'isbn10', 'isbn 10'],
      'isbn13': ['isbn-13', 'isbn13', 'isbn 13'],
      series: ['series', 'series name', 'book series', '系列', '丛书', '叢書'],
      volume: ['volume', 'vol', '卷', '冊', '册']
    };

    var allEls = document.querySelectorAll('div, span, th, dt, li, p, td');
    for (var ei = 0; ei < allEls.length; ei++) {
      var el = allEls[ei];
      var text = (el.textContent || '').trim().toLowerCase().replace(/[:;]$/, '');
      if (!text) continue;

      for (var fi = 0; fi < Object.keys(LABEL_MAP).length; fi++) {
        var field = Object.keys(LABEL_MAP)[fi];
        if (result[field]) continue;
        var labels = LABEL_MAP[field];
        var isMatch = false;
        for (var li = 0; li < labels.length; li++) {
          var l = labels[li];
          if (text === l || text.indexOf(l + ':') === 0 || text.indexOf(l + ';') === 0) {
            isMatch = true;
            break;
          }
        }
        if (!isMatch) continue;

        // Priority: inline content > next sibling > parent's next sibling
        // Inline pattern (<li>Pages: 350</li>): extract text after delimiter
        var value = '';
        var ownText = (el.textContent || '').trim();
        var afterLabel = ownText.replace(/^[^:;]*[:;]\s*/, '').trim();
        if (afterLabel && afterLabel !== ownText) {
          value = afterLabel;
        }
        // Sibling pattern (<td>Pages</td><td>350</td>): read next element
        if (!value) {
          var next = el.nextElementSibling;
          if (next) value = (next.textContent || '').trim();
        }
        // Parent-sibling pattern (<tr><td>Pages</td></tr><tr><td>350</td></tr>)
        if (!value && el.parentElement) {
          var parentNext = el.parentElement.nextElementSibling;
          if (parentNext) value = (parentNext.textContent || '').trim();
        }

        if (value) {
          result[field] = value.replace(/^[:;\s]+|[:;\s]+$/g, '').trim();
        }
      }
    }

    // -- 2. Categories — look for category/tag/genre links -----------
    // Use href-based selectors only. Class-based selectors like
    // [class*="category"] a are too broad and pick up sidebar navigation
    // items (My Library, Download history, etc.), not just book categories.
    // Dedup to avoid entries appearing twice from matching multiple selectors.
    var categorySelectors = [
      'a[href*="/category/"]',
      'a[href*="/categories/"]',
      'a[href*="/subject/"]',
      'a[href*="/booksubject/"]'
    ];
    var catLinks = document.querySelectorAll(categorySelectors.join(','));
    if (catLinks.length > 0) {
      var catParts = [];
      var seen = {};
      for (var ci = 0; ci < catLinks.length; ci++) {
        var catText = (catLinks[ci].textContent || '').trim();
        // Filter out non-category navigation items found in sidebars
        if (catText && !seen[catText] && catText.length > 2) {
          seen[catText] = true;
          catParts.push(catText);
        }
      }
      if (catParts.length) result.categories = catParts.join(', ');
    }

    // -- 3. Description — try common selectors -----------------------
    // Avoid generic selectors like [class*="description"] or [class*="book-info"] p
    // which match sidebar/footer elements (forum descriptions, download hints,
    // Telegram delivery notices, etc.). A real book description is typically
    // 50+ characters of prose, not delivery instructions.
    // 'div.expanded' is a late-loading detail variant — checked last.
    var descSelectors = [
      '.book-description',
      '.book-desc',
      '.description-text',
      '[itemprop="description"]',
      '.detail-description',
      '#book-description',
      'div.expanded'
    ];
    for (var di = 0; di < descSelectors.length; di++) {
      var descEl = document.querySelector(descSelectors[di]);
      if (!descEl) continue;
      var descText = (descEl.textContent || '').trim();
      // Exclude known non-description patterns (download hints, shipping info)
      if (/file will be sent|Telegram|messenger|download|shipping|delivery/i.test(descText)) continue;
      if (descText.length > 40) {
        result.description = descText;
        break;
      }
    }

    // Fallback: find the longest paragraph in the main content area
    // Use 50-char minimum to filter out sidebar blurbs, section headers,
    // and short UI text that isn't a real book description.
    // Exclude known non-description patterns (download hints, delivery info).
    if (!result.description) {
      var main = document.querySelector('main, [role="main"], article, .content, .book-content, #content');
      if (main) {
        var paras = main.querySelectorAll('p');
        var longest = '';
        for (var pi = 0; pi < paras.length; pi++) {
          var t = (paras[pi].textContent || '').trim();
          if (/file will be sent|Telegram|messenger|download|shipping|delivery/i.test(t)) continue;
          if (t.length > longest.length && t.length > 50) longest = t;
        }
        if (longest) result.description = longest;
      }
    }

    // -- 4. Meta description — from <meta name="description"> ---------
    // Z-Library includes all book metadata as a single meta description string.
    // This is useful search-engine-style metadata, not a standalone description.
    // Stored in a separate metaDescription field to avoid confusing with real
    // book description prose.
    var metaEl = document.querySelector('meta[name="description"]');
    if (metaEl) {
      var metaContent = (metaEl.getAttribute('content') || '').trim();
      if (metaContent.length > 10) result.metaDescription = metaContent;
    }

    // -- 5. Detail property fields (year, language, extension, filesize) ---
    // Read from .bookProperty elements on the detail page.
    var propYear = document.querySelector('.bookProperty.property_year .property_value');
    if (propYear) result.year = (propYear.textContent || '').trim();
    var propLang = document.querySelector('.bookProperty.property_language .property_value');
    if (propLang) result.language = (propLang.textContent || '').trim();
    var propFile = document.querySelector('.bookProperty.property__file .property_value');
    if (propFile) {
      var fileText = (propFile.textContent || '').trim();
      // e.g. "EPUB, 2.37 MB"
      var parts = fileText.split(',');
      if (parts.length >= 1) result.extension = parts[0].trim();
      if (parts.length >= 2) result.filesize = parts.slice(1).join(',').trim();
    }

    // -- 6. Rating & Quality — from .book-rating-*-score selectors ------
    var interestEl = document.querySelector('.book-rating-interest-score');
    if (interestEl) result.rating = (interestEl.textContent || '').trim();

    var qualityEl = document.querySelector('.book-rating-quality-score');
    if (qualityEl) result.quality = (qualityEl.textContent || '').trim();

    // -- 7. Main format — from download button label ----------------------
    // NOT extractFormats() — just check primary download link
    var dlBtn = document.querySelector('a[href*="/dl/"]');
    if (dlBtn) {
      var btnText = (dlBtn.textContent || '').trim().toUpperCase();
      if (btnText.includes('PDF')) result.mainFormat = 'pdf';
      else if (btnText.includes('EPUB')) result.mainFormat = 'epub';
      else if (btnText.includes('AZW3')) result.mainFormat = 'azw3';
      else if (btnText.includes('MOBI')) result.mainFormat = 'mobi';
      else result.mainFormat = 'pdf';
    }

    // -- 8. Fallback: parse metaDescription for missing fields -----------
    if (result.metaDescription && result.metaDescription.length > 10) {
      var md = result.metaDescription;
      if (!result.year) {
        var yMatch = md.match(/Year:\s*(\d{4})/i);
        if (yMatch) result.year = yMatch[1];
      }
      if (!result.language) {
        var lMatch = md.match(/Language:\s*(\w+)/i);
        if (lMatch) result.language = lMatch[1];
      }
      if (!result.extension) {
        var fMatch = md.match(/Format:\s*(\w+)/i);
        if (fMatch) result.extension = fMatch[1];
      }
      if (!result.filesize) {
        var fsMatch = md.match(/Filesize:\s*([\d.]+\s*\w+)/i);
        if (fsMatch) result.filesize = fsMatch[1];
      }
      // Categories fallback — parse from metaDescription if not found via links
      if (!result.categories) {
        // Meta description may contain category-like text after book title
        // Keep existing category extraction as primary (href-based selectors)
        // This is intentionally minimal — categories primarily from link extraction
      }
    }

    return { publisher: result.publisher || cardPublisher, isbn: result.isbn || cardIsbn, pages: result.pages, isbn10: result.isbn10, isbn13: result.isbn13, series: result.series, volume: result.volume, categories: result.categories, description: result.description, metaDescription: result.metaDescription, year: result.year, language: result.language, extension: result.extension, filesize: result.filesize, rating: result.rating, mainFormat: result.mainFormat, quality: result.quality };
  `, null)

  // Normalise result — ensure all fields are present (empty string default)
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DETAIL_ATTRS }
  return {
    publisher: String(raw.publisher || ''),
    isbn: String(raw.isbn || ''),
    pages: String(raw.pages || ''),
    isbn10: String(raw.isbn10 || ''),
    isbn13: String(raw.isbn13 || ''),
    series: String(raw.series || ''),
    volume: String(raw.volume || ''),
    categories: String(raw.categories || ''),
    description: String(raw.description || ''),
    metaDescription: String(raw.metaDescription || ''),
    year: String(raw.year || ''),
    language: String(raw.language || ''),
    extension: String(raw.extension || ''),
    filesize: String(raw.filesize || ''),
    mainFormat: String(raw.mainFormat || ''),
    quality: String(raw.quality || ''),
    rating: String(raw.rating || '')
  }
}
