import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

type ShopeeSortBy = 'top-sale' | 'latest' | 'relevance';

type RawSearchItem = {
  href?: string;
  title?: string;
};

type SearchRow = {
  rank: number;
  product_url: string;
  title: string;
};

type SearchPayload = {
  href?: string;
  loginRequired?: boolean;
  items?: RawSearchItem[];
};

const DEFAULT_SHOPEE_ORIGIN = 'https://shopee.com.my';
const SEARCH_ITEM_SELECTOR = 'li.shopee-search-item-result__item[data-sqe="item"]';
const SORT_BY_PARAM: Record<ShopeeSortBy, string> = {
  'top-sale': 'sales',
  latest: 'ctime',
  relevance: 'relevancy',
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeLimit(value: unknown, fallback: number = 20): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), 100);
}

function normalizeSortBy(value: unknown): ShopeeSortBy {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'top-sale';
  if (normalized === 'top-sale' || normalized === 'latest' || normalized === 'relevance') return normalized;
  throw new Error('Unsupported Shopee sortby. Supported values: top-sale, latest, relevance.');
}

function normalizeOrigin(value: unknown): string {
  const raw = normalizeText(value) || DEFAULT_SHOPEE_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!/shopee\./i.test(url.hostname)) {
    throw new Error('Shopee search origin must be a Shopee host.');
  }
  return url.origin;
}

function buildSearchUrl(query: string, sortby: ShopeeSortBy, origin: string = DEFAULT_SHOPEE_ORIGIN): string {
  const url = new URL('/search', normalizeOrigin(origin));
  url.searchParams.set('keyword', query);
  url.searchParams.set('page', '0');
  url.searchParams.set('sortBy', SORT_BY_PARAM[sortby]);
  return url.toString();
}

function canonicalizeProductUrl(href: unknown, baseUrl: string): string {
  const raw = normalizeText(href);
  if (!raw) return '';

  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return '';
  }

  if (!/shopee\./i.test(url.hostname)) return '';
  if (url.pathname.includes('/find_similar_products')) return '';
  const isSlugProduct = /-i\.\d+\.\d+$/i.test(url.pathname);
  const isProductPath = /^\/product\/\d+\/\d+$/i.test(url.pathname);
  if (!isSlugProduct && !isProductPath) return '';

  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildSearchExtractScript(limit: number): string {
  return `
    (() => {
      const limit = ${limit};
      const cardSelector = ${JSON.stringify(SEARCH_ITEM_SELECTOR)};
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const readTitle = (card, anchor) => {
        const aria = normalizeText(anchor?.getAttribute('aria-label') || '');
        if (aria.toLowerCase().startsWith('view product:')) {
          return normalizeText(aria.replace(/^view product:\\s*/i, ''));
        }

        const imgAlt = normalizeText(card.querySelector('img[alt]:not([alt="custom-overlay"]):not([alt="flag-label"])')?.getAttribute('alt') || '');
        if (imgAlt) return imgAlt;

        return normalizeText(card.textContent || '');
      };
      const isLoggedOut = () => {
        const text = normalizeText(document.body?.innerText || '').toLowerCase();
        return Boolean(
          document.querySelector('input[name="loginKey"], input[name="password"], form[action*="login"]') ||
          location.pathname.includes('/buyer/login') ||
          /log in|login|sign in/.test(text) && !document.querySelector(cardSelector)
        );
      };

      const cards = Array.from(document.querySelectorAll(cardSelector));
      const items = [];
      const seen = new Set();
      for (const card of cards) {
        const anchor =
          card.querySelector('a[aria-label^="View product:"][href*="-i."]') ||
          card.querySelector('a[href*="-i."]') ||
          card.querySelector('a[href*="/product/"]');
        const href = anchor?.getAttribute('href') || '';
        if (!href || seen.has(href) || href.includes('/find_similar_products')) continue;
        seen.add(href);
        items.push({
          href,
          title: readTitle(card, anchor),
        });
        if (items.length >= limit) break;
      }

      return {
        href: window.location.href,
        loginRequired: isLoggedOut(),
        items,
      };
    })()
  `;
}

function normalizeSearchRows(payload: SearchPayload, limit: number): SearchRow[] {
  const sourceUrl = normalizeText(payload.href) || DEFAULT_SHOPEE_ORIGIN;
  const rowsByUrl = new Map<string, SearchRow>();

  for (const item of payload.items ?? []) {
    const productUrl = canonicalizeProductUrl(item.href, sourceUrl);
    if (!productUrl || rowsByUrl.has(productUrl)) continue;
    rowsByUrl.set(productUrl, {
      rank: rowsByUrl.size + 1,
      product_url: productUrl,
      title: normalizeText(item.title),
    });
    if (rowsByUrl.size >= limit) break;
  }

  return [...rowsByUrl.values()];
}

async function readSearchResults(page: IPage, query: string, sortby: ShopeeSortBy, limit: number, origin: string): Promise<SearchRow[]> {
  const url = buildSearchUrl(query, sortby, origin);
  await page.goto(url, { waitUntil: 'load' });
  await page.wait({ selector: SEARCH_ITEM_SELECTOR, timeout: 8 }).catch(() => undefined);
  await page.autoScroll({ times: 3, delayMs: 900 });

  const payload = await page.evaluate(buildSearchExtractScript(Math.max(limit * 2, 20))) as SearchPayload;
  if (payload?.loginRequired) {
    throw new AuthRequiredError(
      new URL(origin).hostname,
      'Shopee login required',
    );
  }

  const rows = normalizeSearchRows(payload && typeof payload === 'object' ? payload : {}, limit);
  if (!rows.length) {
    throw new EmptyResultError(
      'shopee search',
      'No Shopee product links were found on the search page. Check login state, query, and page layout.',
    );
  }

  return rows;
}

cli({
  site: 'shopee',
  name: 'search',
  description: 'Search Shopee products and output product links',
  domain: 'shopee.com.my',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'query',
      positional: true,
      required: true,
      help: 'Search keyword, e.g. "camera"',
    },
    {
      name: 'sortby',
      default: 'top-sale',
      choices: ['top-sale', 'latest', 'relevance'],
      help: 'Sort order: top-sale, latest, relevance (default top-sale)',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: 'Maximum product links to return (default 20, max 100)',
    },
    {
      name: 'origin',
      default: DEFAULT_SHOPEE_ORIGIN,
      help: 'Shopee origin, e.g. https://shopee.com.my',
    },
  ],
  columns: ['rank', 'product_url', 'title'],
  func: async (page, args) => {
    const query = normalizeText(args.query);
    if (!query) throw new Error('Shopee search query is required.');
    const sortby = normalizeSortBy(args.sortby);
    const limit = normalizeLimit(args.limit);
    const origin = normalizeOrigin(args.origin);
    return readSearchResults(page, query, sortby, limit, origin);
  },
});

export const __test__ = {
  DEFAULT_SHOPEE_ORIGIN,
  SEARCH_ITEM_SELECTOR,
  SORT_BY_PARAM,
  buildSearchExtractScript,
  buildSearchUrl,
  canonicalizeProductUrl,
  normalizeLimit,
  normalizeOrigin,
  normalizeSearchRows,
  normalizeSortBy,
  normalizeText,
};
