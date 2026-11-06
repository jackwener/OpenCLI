import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

// Buyer-side Facebook Marketplace search: browse listings for sale near a
// location. Complements the seller-side `marketplace-listings` /
// `marketplace-inbox` commands.
//
// Strategy: UI_SELECTOR (visible-ui contract). Every result card on
// /marketplace/<location>/search is an <a href="/marketplace/item/<id>/…">
// whose aria-label carries the whole row in a fixed, comma-separated shape:
//
//   "<title>, <price>[, reduced from <price>], <city>, <state>, listing <id>"
//
// Location is empty for shipped-only items ("…, $40, , listing 123"). The
// aria-label is Facebook's own accessibility contract and survived every DOM
// class reshuffle observed so far; the inner <span>s are used only as a
// fallback when the label is missing or unparseable.

const MAX_LIMIT = 100;
const PAGE_SIZE = 24; // cards Facebook renders per scroll batch
const MAX_SCROLL_ROUNDS = 12;
const SORT_MAP = {
  best: null,
  newest: 'creation_time_descend',
  'price-asc': 'price_ascend',
  'price-desc': 'price_descend',
  distance: 'distance_ascend',
};
const DAYS_CHOICES = [1, 7, 30];

function requireQuery(value) {
  const q = String(value ?? '').trim();
  if (!q) throw new ArgumentError('facebook marketplace-search requires a non-empty query');
  return q;
}

function requireLimit(value) {
  const n = Number(value ?? 20);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ArgumentError(`facebook marketplace-search --limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return n;
}

function optionalPrice(value, flag) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ArgumentError(`facebook marketplace-search ${flag} must be a non-negative number`);
  }
  return n;
}

function optionalLocation(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9]+$/.test(slug)) {
    throw new ArgumentError(
      'facebook marketplace-search --location must be a Marketplace city slug or numeric city id (letters/digits only), e.g. chicago, nyc, 108659242498155',
    );
  }
  return slug;
}

function requireSort(value) {
  const key = String(value ?? 'best').trim().toLowerCase();
  if (!(key in SORT_MAP)) {
    throw new ArgumentError(`facebook marketplace-search --sort must be one of: ${Object.keys(SORT_MAP).join(', ')}`);
  }
  return key;
}

function optionalDays(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!DAYS_CHOICES.includes(n)) {
    throw new ArgumentError(`facebook marketplace-search --days must be one of: ${DAYS_CHOICES.join(', ')}`);
  }
  return n;
}

function buildSearchUrl(opts) {
  const base = opts.location
    ? `https://www.facebook.com/marketplace/${opts.location}/search`
    : 'https://www.facebook.com/marketplace/category/search/';
  const params = new URLSearchParams();
  params.set('query', opts.query);
  if (opts.minPrice !== null && opts.minPrice !== undefined) params.set('minPrice', String(opts.minPrice));
  if (opts.maxPrice !== null && opts.maxPrice !== undefined) params.set('maxPrice', String(opts.maxPrice));
  const sortBy = SORT_MAP[opts.sort ?? 'best'];
  if (sortBy) params.set('sortBy', sortBy);
  if (opts.days) params.set('daysSinceListed', String(opts.days));
  if (opts.exact) params.set('exact', 'true');
  return `${base}?${params.toString()}`;
}

// "$1,234" / "CA$80" / "€50" / "£9.99" / "Free" → { price, currency }
const PRICE_RE = /^(free|[A-Z]{0,3}[$€£¥₹])\s?([\d.,]*)$/i;

function parsePrice(text) {
  const m = String(text ?? '').trim().match(PRICE_RE);
  if (!m) return null;
  if (/^free$/i.test(m[1])) return { price: 0, currency: null };
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return { price: n, currency: m[1] };
}

// Parse Facebook's card aria-label. Returns null when the label does not have
// the expected shape so the caller can fall back to the span-based reading.
function parseListingLabel(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  const idMatch = text.match(/, listing (\d+)$/);
  if (!idMatch) return null;
  const parts = text.slice(0, -idMatch[0].length).split(', ');
  // Walk from the right: [title…, price, (reduced from X)?, location…]
  let priceIdx = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parsePrice(parts[i])) { priceIdx = i; break; }
  }
  if (priceIdx < 1) return null; // no price, or nothing left for a title
  const priced = parsePrice(parts[priceIdx]);
  const title = parts.slice(0, priceIdx).join(', ');
  const rest = parts.slice(priceIdx + 1);
  let originalPrice = null;
  if (rest.length && /^reduced from /i.test(rest[0])) {
    const orig = parsePrice(rest.shift().replace(/^reduced from /i, ''));
    originalPrice = orig ? orig.price : null;
  }
  const location = rest.join(', ').trim();
  return {
    id: idMatch[1],
    title,
    price: priced.price,
    currency: priced.currency,
    originalPrice,
    location: location || null,
  };
}

// Fallback for cards without a usable aria-label: inner spans are
// [badge?, price, title, location?] with each repeated for a11y.
function parseListingSpans(spans) {
  const uniq = [];
  for (const s of spans || []) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (t && !uniq.includes(t)) uniq.push(t);
  }
  const priceIdx = uniq.findIndex((t) => parsePrice(t));
  if (priceIdx < 0) return null;
  const priced = parsePrice(uniq[priceIdx]);
  const after = uniq.slice(priceIdx + 1);
  if (!after.length) return null;
  return {
    title: after[0],
    price: priced.price,
    currency: priced.currency,
    originalPrice: null,
    location: after[1] || null,
  };
}

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && 'data' in value) return value.data;
  return value;
}

function isNavigationRejected(error) {
  return /Navigation rejected/i.test(String(error?.message || error));
}

// The Browser Bridge occasionally rejects the very first navigation of a
// fresh automation tab ("Navigation rejected") and succeeds immediately on
// retry. Mirror google/images.js: retry once, then fall back to a new tab.
async function navigateWithRetry(page, url) {
  const opts = { settleMs: 4000 };
  try {
    await page.goto(url, opts);
    return;
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
  }
  try {
    await page.goto(url, opts);
    return;
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
    if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
      const pageId = await page.newTab(url);
      if (pageId) {
        await page.setActivePage(pageId);
        return;
      }
    }
    throw error;
  }
}

function isAuthPageJs() {
  return `
    function isAuthPage() {
      const path = window.location && window.location.pathname ? window.location.pathname : '';
      const body = String(document.body && document.body.textContent || '').replace(/\\s+/g, ' ').trim();
      return /^\\/(login|checkpoint)(\\/|$|\\.php)/.test(path)
        || /^(Log in to Facebook|Facebook登录|登录 Facebook)/i.test(body)
        || /You must log in to continue/i.test(body);
    }`;
}

// Scroll to the bottom, give Facebook a moment to append the next batch, and
// report how many listing cards are present.
function buildScrollScript() {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    return document.querySelectorAll('a[href*="/marketplace/item/"]').length;
  })()`;
}

function buildExtractScript(limit) {
  return `(() => {
    const limit = ${limit};
    ${isAuthPageJs()}
    const clean = (v) => String(v || '').replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u2060\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
    if (isAuthPage()) return { status: 'auth', href: location.href, rows: [], diagnostics: {} };

    const anchors = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
    const seen = new Set();
    const rows = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\\/marketplace\\/item\\/(\\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const spans = Array.from(a.querySelectorAll('span')).map((s) => clean(s.textContent)).filter(Boolean);
      const img = a.querySelector('img');
      rows.push({
        id,
        label: clean(a.getAttribute('aria-label')),
        spans,
        image: img ? (img.currentSrc || img.src || '') : '',
      });
      if (rows.length >= limit) break;
    }
    return {
      status: rows.length ? 'ok' : 'no_rows',
      href: location.href,
      rows,
      diagnostics: {
        anchorCount: anchors.length,
        mainTextLength: clean((document.querySelector('[role="main"]') || {}).textContent).length,
        hasMarketplaceNav: /Marketplace/i.test(clean(document.body && document.body.textContent).slice(0, 4000)),
      },
    };
  })()`;
}

const BADGE_RE = /^(Just listed|Pending|Sold|Free shipping|Ships to you|Sponsored)$/i;

function normalizeRows(rawRows, limit) {
  const out = [];
  for (const raw of rawRows) {
    const parsed = parseListingLabel(raw.label) || parseListingSpans(raw.spans);
    if (!parsed || !parsed.title) continue;
    const badge = (raw.spans || []).find((s) => BADGE_RE.test(String(s).trim())) || null;
    out.push({
      index: out.length + 1,
      id: String(raw.id),
      title: parsed.title,
      price: parsed.price,
      currency: parsed.currency,
      originalPrice: parsed.originalPrice,
      location: parsed.location,
      badge: badge ? String(badge).trim() : null,
      image: raw.image || null,
      url: `https://www.facebook.com/marketplace/item/${raw.id}/`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchMarketplace(page, kwargs) {
  if (!page) throw new CommandExecutionError('Browser session required for facebook marketplace-search');
  const query = requireQuery(kwargs.query);
  const limit = requireLimit(kwargs.limit);
  const location = optionalLocation(kwargs.location);
  const minPrice = optionalPrice(kwargs['min-price'] ?? kwargs.minPrice, '--min-price');
  const maxPrice = optionalPrice(kwargs['max-price'] ?? kwargs.maxPrice, '--max-price');
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new ArgumentError('facebook marketplace-search --min-price cannot exceed --max-price');
  }
  const sort = requireSort(kwargs.sort);
  const days = optionalDays(kwargs.days);
  const exact = kwargs.exact === true;

  const url = buildSearchUrl({ query, location, minPrice, maxPrice, sort, days, exact });
  try {
    await navigateWithRetry(page, url);
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to open Facebook Marketplace search: ${err instanceof Error ? err.message : err}`,
      'Check that facebook.com is reachable and the browser extension is connected.',
    );
  }

  // Facebook renders ~24 cards per batch; scroll for more when asked for more.
  if (limit > PAGE_SIZE) {
    let prev = -1;
    let stalled = 0;
    for (let i = 0; i < MAX_SCROLL_ROUNDS; i += 1) {
      let count = 0;
      try { count = Number(unwrapBrowserResult(await page.evaluate(buildScrollScript()))) || 0; } catch { break; }
      if (count >= limit) break;
      if (count <= prev) {
        stalled += 1;
        if (stalled >= 2) break;
      } else {
        stalled = 0;
      }
      prev = count;
    }
  }

  let payload;
  try {
    payload = unwrapBrowserResult(await page.evaluate(buildExtractScript(limit)));
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to read Facebook Marketplace results: ${err instanceof Error ? err.message : err}`,
      'Facebook may not have rendered or the Marketplace markup may have changed.',
    );
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new CommandExecutionError('facebook marketplace-search returned malformed extraction payload');
  }
  if (payload.status === 'auth') {
    throw new AuthRequiredError('www.facebook.com', 'Open Chrome and log in to Facebook before retrying.');
  }

  // Facebook silently drops an unknown city slug and redirects to
  // /marketplace/category/search/ (the account's saved location). Surface
  // that instead of returning results for the wrong place.
  if (location && typeof payload.href === 'string' && !payload.href.includes(`/marketplace/${location}/`)) {
    throw new ArgumentError(
      `Facebook did not recognize --location "${location}" and fell back to your saved location. ` +
      'Use the city slug or numeric city id from a Marketplace URL (e.g. chicago, nyc, 108659242498155); only major cities have a named slug. Omit --location to use your saved location.',
    );
  }

  const rows = normalizeRows(payload.rows, limit);
  if (rows.length > 0) return rows;

  const d = payload.diagnostics || {};
  if (d.anchorCount) {
    throw new CommandExecutionError(
      'Facebook Marketplace rendered listing cards but none could be parsed',
      `Diagnostics: anchors=${d.anchorCount}, mainTextLength=${d.mainTextLength || 0}. The card aria-label format may have changed.`,
    );
  }
  throw new EmptyResultError(
    'facebook marketplace-search',
    `No Marketplace listings were visible for "${query}"${location ? ` near ${location}` : ''}. Try a broader query, a wider price range, or a different --location.`,
  );
}

const command = {
  site: 'facebook',
  name: 'marketplace-search',
  access: 'read',
  description: 'Search Facebook Marketplace listings for sale (buyer side)',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'What to search for, e.g. "road bike"' },
    { name: 'location', help: 'City slug or numeric city id from a Marketplace URL (chicago, nyc, 108659242498155). Defaults to your saved location' },
    { name: 'limit', type: 'int', default: 20, help: `Number of listings (1-${MAX_LIMIT}); scrolls for more than ${PAGE_SIZE}` },
    { name: 'min-price', type: 'int', help: 'Minimum price' },
    { name: 'max-price', type: 'int', help: 'Maximum price' },
    { name: 'sort', default: 'best', choices: Object.keys(SORT_MAP), help: 'Sort order' },
    { name: 'days', type: 'int', help: 'Only listings posted within the last N days (1, 7, 30)' },
    { name: 'exact', type: 'boolean', default: false, help: 'Require an exact phrase match' },
  ],
  columns: ['index', 'id', 'title', 'price', 'currency', 'originalPrice', 'location', 'badge', 'image', 'url'],
  func: searchMarketplace,
};

cli(command);

export const __test__ = {
  buildExtractScript,
  buildSearchUrl,
  command,
  normalizeRows,
  optionalDays,
  optionalLocation,
  optionalPrice,
  parseListingLabel,
  parseListingSpans,
  parsePrice,
  requireLimit,
  requireQuery,
  requireSort,
  searchMarketplace,
};
