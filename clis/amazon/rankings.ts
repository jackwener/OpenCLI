import { CommandExecutionError } from '@jackwener/opencli/errors';
import { Strategy, type CliOptions } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import {
  assertUsableState,
  buildProvenance,
  cleanText,
  extractAsin,
  extractCategoryNodeId,
  extractReviewCountFromCardText,
  firstMeaningfulLine,
  gotoAndReadState,
  isRankingPaginationUrl,
  normalizeProductUrl,
  parsePriceText,
  parseRatingValue,
  parseReviewCount,
  resolveRankingUrl,
  toAbsoluteAmazonUrl,
  uniqueNonEmpty,
  type AmazonRankingListType,
} from './shared.js';

export interface RankingCardPayload {
  rank_text?: string | null;
  asin?: string | null;
  title?: string | null;
  href?: string | null;
  price_text?: string | null;
  rating_text?: string | null;
  review_count_text?: string | null;
  card_text?: string | null;
}

interface RankingPagePayload {
  href?: string;
  title?: string;
  list_title?: string;
  category_title?: string;
  category_path?: string[];
  cards?: RankingCardPayload[];
  page_links?: string[];
  visible_category_links?: Array<{
    title?: string | null;
    url?: string | null;
    node_id?: string | null;
  }>;
}

interface RankingCommandDefinition {
  commandName: string;
  listType: AmazonRankingListType;
  description: string;
}

interface RankingNormalizeContext {
  listType: AmazonRankingListType;
  rankFallback: number;
  listTitle: string | null;
  sourceUrl: string;
  categoryTitle: string | null;
  categoryUrl: string | null;
  categoryPath: string[];
  visibleCategoryLinks: Array<{ title: string; url: string; node_id: string | null }>;
}

function parseRank(rawRank: string | null | undefined, fallback: number): number {
  const normalized = cleanText(rawRank);
  const match = normalized.match(/(\d{1,4})/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeVisibleCategoryLinks(
  links: RankingPagePayload['visible_category_links'],
): Array<{ title: string; url: string; node_id: string | null }> {
  const normalized = (links ?? [])
    .map((entry) => ({
      title: cleanText(entry?.title),
      url: toAbsoluteAmazonUrl(entry?.url) ?? '',
      node_id: cleanText(entry?.node_id) || extractCategoryNodeId(entry?.url) || null,
    }))
    .filter((entry) => Boolean(entry.title) && Boolean(entry.url));

  const seen = new Set<string>();
  const deduped: Array<{ title: string; url: string; node_id: string | null }> = [];
  for (const entry of normalized) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    deduped.push(entry);
  }
  return deduped;
}

export function normalizeRankingCandidate(
  candidate: RankingCardPayload,
  context: RankingNormalizeContext,
): Record<string, unknown> {
  const productUrl = normalizeProductUrl(candidate.href);
  const asin = extractAsin(candidate.asin ?? '') ?? extractAsin(productUrl ?? '') ?? null;
  const title = cleanText(candidate.title) || firstMeaningfulLine(candidate.card_text);
  const price = parsePriceText(cleanText(candidate.price_text) || candidate.card_text);
  const ratingText = cleanText(candidate.rating_text) || null;
  const reviewCountText = cleanText(candidate.review_count_text)
    || extractReviewCountFromCardText(candidate.card_text)
    || null;
  const provenance = buildProvenance(context.sourceUrl);
  const categoryUrl = context.categoryUrl || context.sourceUrl;

  return {
    list_type: context.listType,
    rank: parseRank(candidate.rank_text, context.rankFallback),
    asin,
    title: title || null,
    product_url: productUrl,
    price_text: price.price_text,
    price_value: price.price_value,
    currency: price.currency,
    rating_text: ratingText,
    rating_value: parseRatingValue(ratingText),
    review_count_text: reviewCountText,
    review_count: parseReviewCount(reviewCountText),
    list_title: context.listTitle,
    category_title: context.categoryTitle,
    category_url: categoryUrl,
    category_node_id: extractCategoryNodeId(categoryUrl),
    category_path: context.categoryPath,
    visible_category_links: context.visibleCategoryLinks,
    ...provenance,
  };
}

async function readRankingPage(
  page: IPage,
  listType: AmazonRankingListType,
  url: string,
): Promise<RankingPagePayload> {
  const state = await gotoAndReadState(page, url, 2500, listType);
  assertUsableState(state, listType);

  return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      list_title:
        document.querySelector('#zg_banner_text')?.textContent
        || document.querySelector('h1')?.textContent
        || '',
      category_title:
        document.querySelector('#zg_browseRoot .zg_selected')?.textContent
        || document.querySelector('#wayfinding-breadcrumbs_feature_div ul li:last-child')?.textContent
        || document.querySelector('#wayfinding-breadcrumbs_container ul li:last-child')?.textContent
        || '',
      category_path: Array.from(document.querySelectorAll(
        '#zg_browseRoot ul li a, #zg_browseRoot ul li span, ' +
        '#wayfinding-breadcrumbs_feature_div ul li a, #wayfinding-breadcrumbs_feature_div ul li span.a-list-item, ' +
        '#wayfinding-breadcrumbs_container ul li a, #wayfinding-breadcrumbs_container ul li span.a-list-item'
      ))
        .map((entry) => (entry.textContent || '').trim())
        .filter(Boolean),
      cards: Array.from(document.querySelectorAll(
        '.p13n-sc-uncoverable-faceout, .zg-grid-general-faceout, [data-asin][class*="p13n"]'
      )).map((card) => ({
        rank_text:
          card.querySelector('.zg-bdg-text')?.textContent
          || card.querySelector('[class*="rank"]')?.textContent
          || '',
        asin:
          card.getAttribute('data-asin')
          || card.getAttribute('id')
          || '',
        title:
          card.querySelector('[class*="line-clamp"]')?.textContent
          || card.querySelector('img')?.getAttribute('alt')
          || card.querySelector('a[href*="/dp/"]')?.textContent
          || '',
        href:
          card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]')?.href
          || '',
        price_text:
          card.querySelector('.a-price .a-offscreen')?.textContent
          || card.querySelector('.a-color-price')?.textContent
          || '',
        rating_text:
          card.querySelector('[aria-label*="out of 5 stars"]')?.getAttribute('aria-label')
          || '',
        review_count_text:
          card.querySelector('a[href*="#customerReviews"]')?.textContent
          || card.querySelector('.a-size-small')?.textContent
          || '',
        card_text: card.innerText || '',
      })),
      page_links: Array.from(document.querySelectorAll('.a-pagination a[href], li.a-normal a[href], li.a-selected a[href]'))
        .map((anchor) => anchor.href || '')
        .filter(Boolean),
      visible_category_links: Array.from(document.querySelectorAll(
        '#zg_browseRoot a[href], #zg-left-col a[href], [class*="zg-browse"] a[href]'
      )).map((anchor) => ({
        title: (anchor.textContent || '').trim(),
        url: anchor.href || '',
        node_id:
          anchor.getAttribute('data-node-id')
          || anchor.dataset?.nodeid
          || '',
      }))
        .filter((entry) => entry.title && entry.url),
    }))()
  `) as RankingPagePayload;
}

function createEmptyResultHint(commandName: string): string {
  return [
    `Open the same Amazon ${commandName} page in shared Chrome and verify ranked items are visible.`,
    'If the page shows a robot check, clear it manually and retry.',
  ].join(' ');
}

export function createRankingCliOptions(definition: RankingCommandDefinition): CliOptions {
  return {
    site: 'amazon',
    name: definition.commandName,
    description: definition.description,
    domain: 'amazon.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
      {
        name: 'input',
        positional: true,
        help: 'Ranking URL or supported Amazon path. Omit to use the list root.',
      },
      {
        name: 'limit',
        type: 'int',
        default: 100,
        help: 'Maximum number of ranked items to return (default 100)',
      },
    ],
    columns: ['list_type', 'rank', 'asin', 'title', 'price_text', 'rating_value', 'review_count'],
    func: async (page, kwargs) => {
      const limit = Math.max(1, Number(kwargs.limit) || 100);
      const initialUrl = resolveRankingUrl(definition.listType, typeof kwargs.input === 'string' ? kwargs.input : undefined);

      const queue = [initialUrl];
      const visited = new Set<string>();
      const seenEntityKeys = new Set<string>();
      const results: Record<string, unknown>[] = [];
      let listTitle: string | null = null;

      while (queue.length > 0 && results.length < limit) {
        const nextUrl = queue.shift()!;
        if (visited.has(nextUrl)) continue;
        visited.add(nextUrl);

        const payload = await readRankingPage(page, definition.listType, nextUrl);
        const sourceUrl = cleanText(payload.href) || nextUrl;
        listTitle = cleanText(payload.list_title) || cleanText(payload.title) || listTitle;
        const categoryPath = uniqueNonEmpty(payload.category_path ?? []);
        const categoryTitle = cleanText(payload.category_title)
          || (categoryPath.length > 0 ? categoryPath[categoryPath.length - 1] : '');
        const visibleCategoryLinks = normalizeVisibleCategoryLinks(payload.visible_category_links);
        const cards = payload.cards ?? [];

        for (const card of cards) {
          const normalized = normalizeRankingCandidate(card, {
            listType: definition.listType,
            rankFallback: results.length + 1,
            listTitle,
            sourceUrl,
            categoryTitle: categoryTitle || null,
            categoryUrl: sourceUrl,
            categoryPath,
            visibleCategoryLinks,
          });

          const dedupeKey = cleanText(String(normalized.asin ?? ''))
            || cleanText(String(normalized.product_url ?? ''));
          if (dedupeKey && seenEntityKeys.has(dedupeKey)) continue;
          if (dedupeKey) seenEntityKeys.add(dedupeKey);

          results.push(normalized);
          if (results.length >= limit) break;
        }

        const pageLinks = uniqueNonEmpty(payload.page_links ?? []);
        for (const href of pageLinks) {
          const absolute = toAbsoluteAmazonUrl(href);
          if (!absolute || !isRankingPaginationUrl(definition.listType, absolute)) continue;
          if (!visited.has(absolute) && !queue.includes(absolute)) {
            queue.push(absolute);
          }
        }
      }

      if (results.length === 0) {
        throw new CommandExecutionError(
          `amazon ${definition.commandName} did not expose any ranked items`,
          createEmptyResultHint(definition.commandName),
        );
      }

      return results.slice(0, limit);
    },
  };
}

export const __test__ = {
  parseRank,
  normalizeVisibleCategoryLinks,
  normalizeRankingCandidate,
};
