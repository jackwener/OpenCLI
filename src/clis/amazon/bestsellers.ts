import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  buildProvenance,
  cleanText,
  extractAsin,
  extractReviewCountFromCardText,
  firstMeaningfulLine,
  normalizeProductUrl,
  parsePriceText,
  parseRatingValue,
  parseReviewCount,
  resolveBestsellersUrl,
  uniqueNonEmpty,
  assertUsableState,
  gotoAndReadState,
} from './shared.js';

interface BestsellersPagePayload {
  href?: string;
  title?: string;
  list_title?: string;
  cards?: Array<{
    rank_text?: string | null;
    asin?: string | null;
    title?: string | null;
    href?: string | null;
    price_text?: string | null;
    rating_text?: string | null;
    review_count_text?: string | null;
    card_text?: string | null;
  }>;
  page_links?: string[];
}

function normalizeBestsellerCandidate(
  candidate: NonNullable<BestsellersPagePayload['cards']>[number],
  rank: number,
  listTitle: string | null,
  sourceUrl: string,
): Record<string, unknown> {
  const productUrl = normalizeProductUrl(candidate.href);
  const asin = extractAsin(candidate.asin ?? '') ?? extractAsin(productUrl ?? '') ?? null;
  const title = cleanText(candidate.title) || firstMeaningfulLine(candidate.card_text);
  const price = parsePriceText(cleanText(candidate.price_text) || candidate.card_text);
  const ratingText = cleanText(candidate.rating_text) || null;
  const reviewCountText = cleanText(candidate.review_count_text)
    || extractReviewCountFromCardText(candidate.card_text)
    || null;
  const provenance = buildProvenance(sourceUrl);

  return {
    rank,
    asin,
    title: title || null,
    product_url: productUrl,
    list_title: listTitle,
    ...provenance,
    price_text: price.price_text,
    price_value: price.price_value,
    currency: price.currency,
    rating_text: ratingText,
    rating_value: parseRatingValue(ratingText),
    review_count_text: reviewCountText,
    review_count: parseReviewCount(reviewCountText),
  };
}

async function readBestsellersPage(page: IPage, url: string): Promise<BestsellersPagePayload> {
  const state = await gotoAndReadState(page, url, 2500, 'bestsellers');
  assertUsableState(state, 'bestsellers');

  return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      list_title:
        document.querySelector('#zg_banner_text')?.textContent
        || document.querySelector('h1')?.textContent
        || '',
      cards: Array.from(document.querySelectorAll('.p13n-sc-uncoverable-faceout'))
        .map((card) => ({
          rank_text:
            card.querySelector('.zg-bdg-text')?.textContent
            || card.querySelector('[class*="rank"]')?.textContent
            || '',
          asin: card.id || '',
          title:
            card.querySelector('[class*="line-clamp"]')?.textContent
            || card.querySelector('img')?.getAttribute('alt')
            || '',
          href: card.querySelector('a[href*="/dp/"]')?.href || '',
          price_text: card.querySelector('.a-price .a-offscreen')?.textContent || '',
          rating_text: card.querySelector('[aria-label*="out of 5 stars"]')?.getAttribute('aria-label') || '',
          review_count_text:
            card.querySelector('a[href*="#customerReviews"]')?.textContent
            || card.querySelector('.a-size-small')?.textContent
            || '',
          card_text: card.innerText || '',
        })),
      page_links: Array.from(document.querySelectorAll('li.a-normal a, li.a-selected a'))
        .map((anchor) => anchor.href || '')
        .filter((href) => /\\/zgbs\\//.test(href) && /(?:[?&]pg=|ref=zg_bs_pg_)/.test(href)),
    }))()
  `) as BestsellersPagePayload;
}

cli({
  site: 'amazon',
  name: 'bestsellers',
  description: 'Amazon Best Sellers pages for category candidate discovery',
  domain: 'amazon.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'input',
      positional: true,
      help: 'Best sellers URL or /zgbs path. Omit to use the root Best Sellers page.',
    },
    {
      name: 'limit',
      type: 'int',
      default: 100,
      help: 'Maximum number of ranked items to return (default 100)',
    },
  ],
  columns: ['rank', 'asin', 'title', 'price_text', 'rating_value', 'review_count'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Number(kwargs.limit) || 100);
    const initialUrl = resolveBestsellersUrl(typeof kwargs.input === 'string' ? kwargs.input : undefined);

    const queue = [initialUrl];
    const visited = new Set<string>();
    const seenAsins = new Set<string>();
    const results: Record<string, unknown>[] = [];
    let listTitle: string | null = null;

    while (queue.length > 0 && results.length < limit) {
      const nextUrl = queue.shift()!;
      if (visited.has(nextUrl)) continue;
      visited.add(nextUrl);

      const payload = await readBestsellersPage(page, nextUrl);
      const sourceUrl = cleanText(payload.href) || nextUrl;
      listTitle = cleanText(payload.list_title) || cleanText(payload.title) || listTitle;
      const cards = payload.cards ?? [];

      for (const card of cards) {
        const normalized = normalizeBestsellerCandidate(card, results.length + 1, listTitle, sourceUrl);
        const asin = cleanText(String(normalized.asin ?? ''));
        if (!asin || seenAsins.has(asin)) continue;
        seenAsins.add(asin);
        results.push(normalized);
        if (results.length >= limit) break;
      }

      const pageLinks = uniqueNonEmpty(payload.page_links ?? []);
      for (const href of pageLinks) {
        if (!visited.has(href) && !queue.includes(href)) {
          queue.push(href);
        }
      }
    }

    if (results.length === 0) {
      throw new CommandExecutionError(
        'amazon bestsellers did not expose any ranked items',
        'Open the same best sellers page in Chrome, verify it is a real Amazon ranking page, and retry.',
      );
    }

    return results.slice(0, limit);
  },
});

export const __test__ = {
  normalizeBestsellerCandidate,
};
