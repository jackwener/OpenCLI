import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  FACTORY_BADGE_PATTERNS,
  SERVICE_BADGE_PATTERNS,
  assertNotCaptcha,
  buildProvenance,
  buildSearchUrl,
  cleanText,
  extractBadges,
  extractLocation,
  extractMemberId,
  extractOfferId,
  extractShopId,
  gotoAndReadState,
  limitCandidates,
  parseMoqText,
  parsePriceText,
  uniqueNonEmpty,
} from './shared.js';

interface SearchPayload {
  href?: string;
  title?: string;
  bodyText?: string;
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

const SEARCH_ITEM_URL_PATTERNS = [
  'detail.1688.com/offer/',
  'detail.m.1688.com/page/index.html?offerId=',
];

function normalizeSearchCandidate(
  candidate: NonNullable<SearchPayload['candidates']>[number],
  rank: number,
  sourceUrl: string,
): Record<string, unknown> {
  const itemUrl = cleanText(candidate.item_url);
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
  const sellerUrl = cleanText(candidate.seller_url);
  const evidenceText = uniqueNonEmpty([
    containerText,
    ...(candidate.desc_rows ?? []),
    ...(candidate.tag_items ?? []),
    ...(candidate.hover_items ?? []),
  ]).join('\n');
  const badges = extractBadges(evidenceText, [...FACTORY_BADGE_PATTERNS, ...SERVICE_BADGE_PATTERNS]);
  const salesText = firstNonEmpty([
    extractSalesText(candidate.sales_text),
    extractSalesText(containerText) ?? '',
  ]) || null;

  return {
    rank,
    offer_id: extractOfferId(itemUrl),
    member_id: extractMemberId(sellerUrl),
    shop_id: extractShopId(sellerUrl),
    title: cleanText(candidate.title) || firstLine(containerText),
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    strategy: 'cookie',
    price_text: priceRange.price_text,
    price_min: priceRange.price_min,
    price_max: priceRange.price_max,
    currency: priceRange.currency ?? 'CNY',
    moq_text: moq.moq_text,
    moq_value: moq.moq_value,
    seller_name: cleanText(candidate.seller_name) || null,
    seller_url: sellerUrl || null,
    item_url: itemUrl,
    location: extractLocation(containerText),
    badges,
    sales_text: salesText,
    return_rate_text: extractReturnRateText(candidate.tag_items ?? []),
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

function extractSalesText(text: string | null | undefined): string | null {
  const normalized = normalizeInlineText(text);
  if (!normalized) return null;
  if (/^\d+(?:\.\d+)?\+?\s*(件|套|个|单)$/.test(normalized)) {
    return normalized;
  }
  const match = normalized.match(/(?:已售|销量|售)\s*\d+(?:\.\d+)?\+?\s*(件|套|个|单)?/);
  return match ? cleanText(match[0]) : null;
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

async function readSearchPayload(page: IPage, query: string): Promise<SearchPayload> {
  const url = buildSearchUrl(query);
  const state = await gotoAndReadState(page, url, 2500, 'search');
  assertNotCaptcha(state, 'search');

  return await page.evaluate(`
    (() => {
      const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const isItemHref = (href) => ${JSON.stringify(SEARCH_ITEM_URL_PATTERNS)}.some((pattern) => (href || '').includes(pattern));
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
          if (host === 's.1688.com' || host === 'r.1688.com' || host === 'air.1688.com' || host === 'detail.1688.com' || host === 'detail.m.1688.com' || host === 'dj.1688.com') {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      };
      const collectCandidates = () => {
        const anchors = Array.from(document.querySelectorAll('a')).filter((anchor) => isItemHref(anchor.href || ''));
        const seen = new Set();
        const items = [];

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

      return {
        href: window.location.href,
        title: document.title || '',
        bodyText: document.body ? document.body.innerText || '' : '',
        candidates: collectCandidates(),
      };
    })()
  `) as SearchPayload;
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
      default: 20,
      help: '结果数量上限（默认 20）',
    },
  ],
  columns: ['rank', 'title', 'price_text', 'moq_text', 'seller_name', 'location'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '');
    const limit = Math.max(1, Number(kwargs.limit) || 20);
    const payload = await readSearchPayload(page, query);
    const sourceUrl = cleanText(payload.href) || buildSearchUrl(query);
    const candidates = limitCandidates(payload.candidates ?? [], limit)
      .filter((candidate) => cleanText(candidate.item_url));

    if (candidates.length === 0) {
      throw new CommandExecutionError(
        '1688 search did not expose any result cards',
        'The search page likely hit a slider challenge or changed its DOM. Open the same query in Chrome, solve any challenge, keep a clean 1688 tab selected, and retry.',
      );
    }

    const provenance = buildProvenance(sourceUrl);
    return candidates.map((candidate, index) => ({
      ...normalizeSearchCandidate(candidate, index + 1, sourceUrl),
      fetched_at: provenance.fetched_at,
      strategy: provenance.strategy,
    }));
  },
});

export const __test__ = {
  normalizeSearchCandidate,
  extractMoqText,
  extractSalesText,
  firstLine,
};
