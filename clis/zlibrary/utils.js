/**
 * Z-Library adapter utilities.
 *
 * Z-Library rotates mirrors constantly and serves two different result markups
 * (a legacy `div.resItemBox` list and the newer `<z-bookcard>` custom elements).
 * This module keeps the mirror liste and the extraction logic in one place so
 * the `search` and `info` commands work against whichever mirror is alive.
 */

import { ArgumentError } from '@jackwener/opencli/errors';

/**
 * Mirrors are tried in order. Override with a comma-separated list:
 *   OPENCLI_ZLIBRARY_MIRROR=https://z-lib.id,https://z-library.sk
 * Values may be bare hosts or full http(s) origins (the latter also makes the
 * adapter testable against a local fixture server).
 */
const DEFAULT_MIRRORS = ['z-lib.id', 'z-library.sk', '1lib.sk', 'z-library.im'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/**
 * Mirrors are shaped like `z-lib.<tld>`, `z-library.<tld>`, `1lib.<tld>`,
 * `booksc.<tld>` or `b-ok.<tld>`, optionally behind one regional subdomain.
 * The anchor plus "exactly one TLD label" is what rejects hostile lookalikes
 * such as `z-lib.id.evil.com` or `z-library.attacker.tld`; the TLD itself is
 * deliberately not enumerated, because Z-Library keeps moving to new ones
 * (`z-lib.ai` and `z-lib.fm` are live today).
 */
const BRAND_RE = /^(?:[a-z0-9-]+\.)?(?:z-?library|z-?lib|1lib|booksc|b-ok)\.[a-z]{2,24}$/;

export function resolveOrigin(mirror) {
  const value = String(mirror || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    // Credentials in a mirror must never reach search URLs or error hints.
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return withScheme;
  }
}

export function getMirrors() {
  let raw = '';
  try {
    raw = (typeof process !== 'undefined' && process.env && process.env.OPENCLI_ZLIBRARY_MIRROR) || '';
  } catch {
    raw = '';
  }
  const text = String(raw).trim();
  const configured = text
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  // Blank means "no override"; a value made only of separators is a config
  // typo and must not silently fall back to the default list.
  if (text) {
    throw new ArgumentError('OPENCLI_ZLIBRARY_MIRROR is set but lists no mirrors');
  }
  return DEFAULT_MIRRORS;
}

export function hostOf(mirror) {
  try {
    return new URL(resolveOrigin(mirror)).hostname;
  } catch {
    return '';
  }
}

/**
 * Validate `--mirror` instead of silently falling back to the default list when
 * the caller passed an empty value.
 */
export function readMirror(raw) {
  const value = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!value) throw new ArgumentError('zlibrary mirror cannot be empty');
  let parsed;
  try {
    parsed = new URL(resolveOrigin(value));
  } catch {
    parsed = null;
  }
  // A book URL pasted into --mirror builds a nonsense search URL; reject it here.
  if (!parsed || !parsed.hostname || parsed.pathname !== '/' || parsed.search) {
    throw new ArgumentError(
      `zlibrary mirror must be a host or origin, got: ${value}`,
      'Example: z-lib.id or https://z-lib.id',
    );
  }
  return value;
}

/**
 * Validate `--limit` instead of silently clamping it (repo convention: invalid
 * input raises a typed ArgumentError so agents can see it).
 */
export function readLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new ArgumentError(`zlibrary limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

/**
 * A host is a Z-Library host if it is a configured mirror, or if it looks like
 * one AND sits on a TLD Z-Library has used. A bare prefix test would accept
 * hostile hosts such as `z-lib.id.evil.com`.
 */
export function isZlibraryHost(hostname) {
  // A trailing dot is DNS-equivalent to the bare name.
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  let configured = [];
  try {
    configured = getMirrors();
  } catch {
    // A broken OPENCLI_ZLIBRARY_MIRROR must not break read-only URL checks.
    configured = [];
  }
  if (configured.some(mirror => hostOf(mirror).toLowerCase().replace(/\.$/, '') === host)) return true;
  return BRAND_RE.test(host);
}

/**
 * Z-Library accepts two search URL shapes: `?q=` (canonical, used by the live
 * site) and the `/s/<query>` path (served by some mirrors; 404 on z-lib.id).
 */
export function buildSearchUrls(query, mirror) {
  const normalized = String(query || '').trim();
  if (!normalized) {
    throw new ArgumentError('zlibrary search query cannot be empty');
  }
  const origin = resolveOrigin(mirror);
  if (!origin) {
    throw new ArgumentError('zlibrary mirror cannot be empty');
  }
  const encoded = encodeURIComponent(normalized);
  return [`${origin}/s?q=${encoded}`, `${origin}/s/${encoded}`];
}

export function normalizeZlibraryBookUrl(input) {
  const raw = String(input || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ArgumentError(
      'Z-Library book URL must be a valid http(s) URL',
      'Example: https://z-lib.id/book/...',
    );
  }
  // Never echo credentials back into the output columns.
  url.username = '';
  url.password = '';
  if (!['http:', 'https:'].includes(url.protocol) || !isZlibraryHost(url.hostname)) {
    throw new ArgumentError(
      `Unsupported Z-Library URL host: ${url.hostname}`,
      'Pass a book URL on a Z-Library mirror, for example https://z-lib.id/book/...',
    );
  }
  return url.toString();
}

/**
 * Extraction script for a search results page.
 *
 * Runs inside the page (string, not a closure) because `page.evaluate` takes a
 * string here. It understands both result markups and returns a JSON array.
 * Only fields the site actually renders are extracted: the result cards carry
 * Year / Language / File but no file size.
 */
export function buildSearchExtractScript(limit) {
  const max = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;
  return `
    JSON.stringify((() => {
      const rows = [];
      const text = (node) => (node && node.textContent ? node.textContent : '');
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

      // Newer UI: <z-bookcard> custom elements, link may live in a shadow root.
      document.querySelectorAll('z-bookcard').forEach((card) => {
        let link = null;
        try {
          if (card.shadowRoot) link = card.shadowRoot.querySelector('a');
        } catch (e) {
          link = null;
        }
        if (!link && typeof card.querySelector === 'function') link = card.querySelector('a');
        const lines = String(card.textContent || '')
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean);
        rows.push({
          title: lines[0] || '',
          author: lines[1] || '',
          url: link ? link.href : '',
          meta: clean(card.textContent),
        });
      });

      // Legacy UI: div.resItemBox blocks with h3[itemprop=name] and .authors.
      document.querySelectorAll('div.resItemBox').forEach((box) => {
        const anchor = box.querySelector('h3[itemprop="name"] a') || box.querySelector('h3 a');
        const authorBox = box.querySelector('.authors');
        const authors = authorBox
          ? clean(text(authorBox))
          : Array.from(box.querySelectorAll('a[itemprop="author"]'))
              .map((node) => clean(text(node)))
              .join(', ');
        rows.push({
          title: clean(text(anchor)),
          author: authors,
          url: anchor ? anchor.href : '',
          meta: clean(box.innerText || box.textContent),
        });
      });

      const pick = (meta, re) => {
        const match = meta.match(re);
        return match ? clean(match[1]) : '';
      };

      return rows
        .map((row) => ({
          title: clean(row.title),
          author: clean(row.author),
          url: row.url || '',
          year: pick(row.meta, /Year:\\s*([0-9]{4})/),
          language: pick(row.meta, /Language:\\s*([\\p{L}() ]{2,30}?)\\s*(?:File:|Publisher:|ISBN:|Year:|Your tags:|$)/u),
          format: pick(row.meta, /File:\\s*([A-Za-z0-9]{2,6})/),
        }))
        .filter((row) => row.title && row.url)
        .slice(0, ${max})
        .map((row, index) => ({ rank: index + 1, ...row }));
    })())
  `;
}

export async function extractBookTitle(page) {
  const title = await page.evaluate(`
      (() => {
        const card = document.querySelector('z-bookcard');
        if (card) {
          let el = null;
          try {
            if (card.shadowRoot) el = card.shadowRoot.querySelector('[class*="title"], h1, a');
          } catch (e) {
            el = null;
          }
          if (!el) el = card.querySelector('[class*="title"], h1, a');
          if (el && el.textContent) return el.textContent.trim().split('\\n')[0].trim();
        }
        const heading = document.querySelector('h1[itemprop="name"], h1');
        if (heading && heading.textContent) return heading.textContent.trim();
        return document.title.replace(/\\s*[-|].*$/, '').trim();
      })()
    `);
  return String(title || '').trim();
}

export async function extractFormats(page) {
  await page.evaluate(`
      (() => {
        const btn = document.querySelector(
          'button[aria-label*="more" i], [class*="dots" i], [class*="more" i]'
        );
        if (btn) btn.click();
      })()
    `);
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
