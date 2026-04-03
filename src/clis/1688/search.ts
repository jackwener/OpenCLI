import { CommandExecutionError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  FACTORY_BADGE_PATTERNS,
  SERVICE_BADGE_PATTERNS,
  assertAuthenticatedState,
  buildProvenance,
  buildSearchUrl,
  canonicalizeItemUrl,
  canonicalizeSellerUrl,
  cleanText,
  extractBadges,
  extractLocation,
  extractMemberId,
  extractOfferId,
  extractShopId,
  gotoAndReadState,
  parseMoqText,
  parsePriceText,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  parseSearchLimit,
  uniqueNonEmpty,
} from './shared.js';

interface SearchPayload {
  href?: string;
  title?: string;
  bodyText?: string;
  next_url?: string;
  candidates?: Array<{
    item_url?: string;
    title?: string;
    container_text?: string;
    desc_rows?: string[];
    price_text?: string | null;
    sales_text?: string | null;
    hover_price_text?: string | null;
    moq_text?: string | null;
    tag_items?: string[];
    hover_items?: string[];
    seller_name?: string | null;
    seller_url?: string | null;
  }>;
}

interface SearchRow {
  rank: number;
  offer_id: string | null;
  member_id: string | null;
  shop_id: string | null;
  title: string | null;
  item_url: string | null;
  seller_name: string | null;
  seller_url: string | null;
  price_text: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  moq_text: string | null;
  moq_value: number | null;
  location: string | null;
  badges: string[];
  sales_text: string | null;
  return_rate_text: string | null;
  source_url: string;
  fetched_at: string;
  strategy: string;
}

const SEARCH_ITEM_URL_PATTERNS = [
  'detail.1688.com/offer/',
  'detail.m.1688.com/page/index.html?offerId=',
];
const MAX_SEARCH_PAGES = 12;

function normalizeSearchCandidate(
  candidate: NonNullable<SearchPayload['candidates']>[number],
  sourceUrl: string,
): SearchRow {
  const canonicalItemUrl = canonicalizeItemUrl(cleanText(candidate.item_url));
  const containerText = cleanText(candidate.container_text);
  const priceText = firstNonEmpty([
    normalizeInlineText(candidate.price_text),
    normalizeInlineText(extractPriceText(candidate.hover_price_text)),
  ]);
  const priceRange = parsePriceText(priceText || containerText);
  const moq = parseMoqText(firstNonEmpty([
    normalizeInlineText(candidate.moq_text),
    normalizeInlineText(extractMoqText(candidate.hover_price_text)),
    normalizeInlineText(extractMoqText(containerText)),
  ]));
  const canonicalSellerUrl = canonicalizeSellerUrl(cleanText(candidate.seller_url));
  const evidenceText = uniqueNonEmpty([
    containerText,
    ...(candidate.desc_rows ?? []),
    ...(candidate.tag_items ?? []),
    ...(candidate.hover_items ?? []),
  ]).join('\n');
  const badges = extractBadges(evidenceText, [...FACTORY_BADGE_PATTERNS, ...SERVICE_BADGE_PATTERNS]);
  const salesText = firstNonEmpty([
    extractSalesText(candidate.sales_text),
    extractSalesText(containerText),
  ]);
  const returnRateText = extractReturnRateText([...(candidate.tag_items ?? []), ...(candidate.hover_items ?? [])]);
  const provenance = buildProvenance(sourceUrl);

  return {
    rank: 0,
    offer_id: extractOfferId(canonicalItemUrl ?? '') ?? null,
    member_id: extractMemberId(canonicalSellerUrl ?? '') ?? null,
    shop_id: extractShopId(canonicalSellerUrl ?? '') ?? null,
    title: cleanText(candidate.title) || firstLine(containerText) || null,
    item_url: canonicalItemUrl,
    seller_name: cleanText(candidate.seller_name) || null,
    seller_url: canonicalSellerUrl,
    price_text: priceRange.price_text || null,
    price_min: priceRange.price_min,
    price_max: priceRange.price_max,
    currency: priceRange.currency,
    moq_text: moq.moq_text || null,
    moq_value: moq.moq_value,
    location: extractLocation(containerText),
    badges,
    sales_text: salesText || null,
    return_rate_text: returnRateText,
    source_url: provenance.source_url,
    fetched_at: provenance.fetched_at,
    strategy: provenance.strategy,
  };
}

function extractMoqText(text: string | null | undefined): string {
  const normalized = normalizeInlineText(text);
  return normalized.match(/\d+(?:\.\d+)?\s*(件|个|套|箱|包|双|台|把|只)\s*起批/i)?.[0]
    ?? normalized.match(/≥\s*\d+(?:\.\d+)?\s*(件|个|套|箱|包|双|台|把|只)?/i)?.[0]
    ?? normalized.match(/\d+(?:\.\d+)?\s*(?:~|-|至|到)\s*\d+(?:\.\d+)?\s*(件|个|套|箱|包|双|台|把|只)/i)?.[0]
    ?? '';
}

function extractPriceText(text: string | null | undefined): string {
  const normalized = normalizeInlineText(text);
  return normalized.match(/[¥$€]\s*\d+(?:\.\d+)?/)?.[0] ?? '';
}

function extractSalesText(text: string | null | undefined): string {
  const normalized = normalizeInlineText(text);
  if (!normalized) return '';
  if (/^\d+(?:\.\d+)?\+?\s*(件|套|个|单)$/.test(normalized)) {
    return normalized;
  }
  const match = normalized.match(/(?:已售|销量|售)\s*\d+(?:\.\d+)?\+?\s*(件|套|个|单)?/);
  return match ? cleanText(match[0]) : '';
}

function firstLine(text: string): string {
  return text.split(/\s+/).find(Boolean) ?? '';
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  return values.map((value) => cleanText(value)).find(Boolean) ?? '';
}

function normalizeInlineText(text: string | null | undefined): string {
  return cleanText(text)
    .replace(/([¥$€])\s+(?=\d)/g, '$1')
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
    .replace(/\s*([~-])\s*/g, '$1')
    .trim();
}

function extractReturnRateText(values: string[]): string | null {
  return uniqueNonEmpty(values.map((value) => normalizeInlineText(value)))
    .find((value) => /^回头率\s*\d+(?:\.\d+)?%$/.test(value))
    ?? null;
}

function buildDedupeKey(row: Pick<SearchRow, 'offer_id' | 'item_url'>): string | null {
  if (row.offer_id) return `offer:${row.offer_id}`;
  if (row.item_url) return `url:${row.item_url}`;
  return null;
}

async function readSearchPayload(page: IPage, url: string): Promise<SearchPayload> {
  const state = await gotoAndReadState(page, url, 2500, 'search');
  assertAuthenticatedState(state, 'search');

  const payload = await page.evaluate(`
    (() => {
      const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalizeUrl = (href) => {
        if (!href) return '';
        try {
          return new URL(href, window.location.href).toString();
        } catch {
          return '';
        }
      };
      const isItemHref = (href) => ${JSON.stringify(SEARCH_ITEM_URL_PATTERNS)}
        .some((pattern) => (href || '').includes(pattern));
      const uniqueTexts = (values) => [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
      const collectTexts = (root, selector) => uniqueTexts(
        Array.from(root.querySelectorAll(selector)).map((node) => node.innerText || node.textContent || ''),
      );
      const firstText = (root, selectors) => {
        for (const selector of selectors) {
          const node = root.querySelector(selector);
          const value = normalizeText(node ? node.innerText || node.textContent || '' : '');
          if (value) return value;
        }
        return '';
      };
      const findMoqText = (values, priceText) => {
        const moqPattern = /(≥\\s*\\d+(?:\\.\\d+)?\\s*(件|个|套|箱|包|双|台|把|只)?)|(\\d+(?:\\.\\d+)?\\s*(?:~|-|至|到)\\s*\\d+(?:\\.\\d+)?\\s*(件|个|套|箱|包|双|台|把|只))|(\\d+(?:\\.\\d+)?\\s*(件|个|套|箱|包|双|台|把|只)\\s*起批)/i;
        return values.find((value) => moqPattern.test(value))
          || normalizeText(priceText).match(moqPattern)?.[0]
          || '';
      };
      const isSellerHref = (href) => {
        if (!href) return false;
        try {
          const url = new URL(href, window.location.href);
          const host = url.hostname || '';
          if (!host.endsWith('.1688.com')) return false;
          if (
            host === 's.1688.com'
            || host === 'r.1688.com'
            || host === 'air.1688.com'
            || host === 'detail.1688.com'
            || host === 'detail.m.1688.com'
            || host === 'dj.1688.com'
          ) {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      };
      const pickContainer = (anchor) => {
        let node = anchor;
        while (node && node !== document.body) {
          const text = normalizeText(node.innerText || node.textContent || '');
          if (text.length >= 40 && text.length <= 2000) {
            return node;
          }
          node = node.parentElement;
        }
        return anchor;
      };
      const collectCandidates = () => {
        const anchors = Array.from(document.querySelectorAll('a')).filter((anchor) => isItemHref(anchor.href || ''));
        const seen = new Set();
        const items = [];
        for (const anchor of anchors) {
          const href = anchor.href || '';
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const container = pickContainer(anchor);
          const tagItems = collectTexts(container, '.offer-tag-row .offer-desc-item');
          const hoverItems = collectTexts(container, '.offer-hover-wrapper .offer-desc-item');
          const sellerAnchor = Array.from(container.querySelectorAll('a'))
            .find((link) => isSellerHref(link.href || ''));
          const hoverPriceText = firstText(container, [
            '.offer-hover-wrapper .hover-price-item',
            '.offer-hover-wrapper .price-item',
          ]);

          items.push({
            item_url: href,
            title: firstText(container, ['.offer-title-row .title-text', '.offer-title-row'])
              || normalizeText(anchor.innerText || anchor.textContent || ''),
            container_text: normalizeText(container.innerText || container.textContent || ''),
            desc_rows: collectTexts(container, '.offer-desc-row'),
            price_text: firstText(container, ['.offer-price-row .price-item']),
            sales_text: firstText(container, ['.offer-price-row .col-desc_after', '.offer-desc-row .col-desc_after']),
            hover_price_text: hoverPriceText,
            moq_text: findMoqText(hoverItems, hoverPriceText),
            tag_items: tagItems,
            hover_items: hoverItems,
            seller_name: sellerAnchor ? normalizeText(sellerAnchor.innerText || sellerAnchor.textContent || '') : null,
            seller_url: sellerAnchor ? sellerAnchor.href : null,
          });
        }
        return items;
      };
      const findNextUrl = () => {
        const selectors = [
          'a.fui-next:not(.disabled)',
          'a.next-pagination-item:not(.disabled)',
          'a[rel="next"]:not(.disabled)',
          'a[data-role="next"]:not(.disabled)',
        ];
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (!node) continue;
          const href = normalizeUrl(node.getAttribute('href') || node.href || '');
          if (href) return href;
        }
        const textBased = Array.from(document.querySelectorAll('a'))
          .find((node) => /下一页|next/i.test(normalizeText(node.textContent || '')));
        if (!textBased) return '';
        return normalizeUrl(textBased.getAttribute('href') || textBased.href || '');
      };

      return {
        href: window.location.href,
        title: document.title || '',
        bodyText: document.body ? document.body.innerText || '' : '',
        next_url: findNextUrl(),
        candidates: collectCandidates(),
      };
    })()
  `) as SearchPayload;

  if (!payload || typeof payload !== 'object') {
    throw new CommandExecutionError(
      '1688 search page did not return a readable payload',
      'Open the same query in Chrome and verify the page is fully loaded before retrying.',
    );
  }

  return payload;
}

async function collectSearchRows(page: IPage, query: string, limit: number): Promise<SearchRow[]> {
  const rowsByKey = new Map<string, SearchRow>();
  const seenPages = new Set<string>();
  let nextUrl = buildSearchUrl(query);
  let pageCount = 0;

  while (nextUrl && rowsByKey.size < limit && pageCount < MAX_SEARCH_PAGES) {
    if (seenPages.has(nextUrl)) break;
    seenPages.add(nextUrl);
    pageCount += 1;

    const payload = await readSearchPayload(page, nextUrl);
    const sourceUrl = cleanText(payload.href) || nextUrl;
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

    for (const candidate of candidates) {
      const row = normalizeSearchCandidate(candidate, sourceUrl);
      const dedupeKey = buildDedupeKey(row);
      if (!dedupeKey || rowsByKey.has(dedupeKey)) continue;
      rowsByKey.set(dedupeKey, row);
      if (rowsByKey.size >= limit) break;
    }

    const candidateNextUrl = cleanText(payload.next_url);
    if (!candidateNextUrl || candidateNextUrl === sourceUrl) break;
    nextUrl = candidateNextUrl;
  }

  if (rowsByKey.size === 0) {
    throw new EmptyResultError(
      '1688 search',
      'No visible results were extracted. Retry with a different query or open the same search page in Chrome first.',
    );
  }

  return [...rowsByKey.values()]
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

cli({
  site: '1688',
  name: 'search',
  description: '1688 商品搜索（结果候选、卖家链接、价格/MOQ/销量文本）',
  domain: 'www.1688.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'query',
      required: true,
      positional: true,
      help: '搜索关键词，如 "置物架"',
    },
    {
      name: 'limit',
      type: 'int',
      default: SEARCH_LIMIT_DEFAULT,
      help: `结果数量上限（默认 ${SEARCH_LIMIT_DEFAULT}，最大 ${SEARCH_LIMIT_MAX}）`,
    },
  ],
  columns: ['rank', 'title', 'price_text', 'moq_text', 'seller_name', 'location'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '');
    const limit = parseSearchLimit(kwargs.limit);
    return collectSearchRows(page, query, limit);
  },
});

export const __test__ = {
  normalizeSearchCandidate,
  extractMoqText,
  extractSalesText,
  firstLine,
  buildDedupeKey,
};
