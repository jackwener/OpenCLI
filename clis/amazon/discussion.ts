import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import {
  buildDiscussionUrl,
  buildProvenance,
  cleanText,
  extractAsin,
  normalizeProductUrl,
  parseRatingValue,
  parseReviewCount,
  trimRatingPrefix,
  uniqueNonEmpty,
  assertUsableState,
  gotoAndReadState,
} from './shared.js';

interface DiscussionPayload {
  href?: string;
  title?: string;
  average_rating_text?: string | null;
  total_review_count_text?: string | null;
  qa_links?: string[];
  review_samples?: Array<{
    title?: string | null;
    rating_text?: string | null;
    author?: string | null;
    date_text?: string | null;
    body?: string | null;
    verified?: boolean;
  }>;
}

function normalizeDiscussionPayload(payload: DiscussionPayload): Record<string, unknown> {
  const sourceUrl = cleanText(payload.href) || buildDiscussionUrl(payload.href ?? '');
  const asin = extractAsin(payload.href ?? '') ?? null;
  const averageRatingText = cleanText(payload.average_rating_text) || null;
  const totalReviewCountText = cleanText(payload.total_review_count_text) || null;
  const provenance = buildProvenance(sourceUrl);

  return {
    asin,
    product_url: asin ? normalizeProductUrl(asin) : null,
    discussion_url: sourceUrl,
    ...provenance,
    average_rating_text: averageRatingText,
    average_rating_value: parseRatingValue(averageRatingText),
    total_review_count_text: totalReviewCountText,
    total_review_count: parseReviewCount(totalReviewCountText),
    qa_urls: uniqueNonEmpty(payload.qa_links ?? []),
    review_samples: (payload.review_samples ?? []).map((sample) => ({
      title: trimRatingPrefix(sample.title) || null,
      rating_text: cleanText(sample.rating_text) || null,
      rating_value: parseRatingValue(sample.rating_text),
      author: cleanText(sample.author) || null,
      date_text: cleanText(sample.date_text) || null,
      body: cleanText(sample.body) || null,
      verified_purchase: sample.verified === true,
    })),
  };
}

async function readDiscussionPayload(page: IPage, input: string, limit: number): Promise<DiscussionPayload> {
  const url = buildDiscussionUrl(input);
  const state = await gotoAndReadState(page, url, 2500, 'discussion');
  assertUsableState(state, 'discussion');

  return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      average_rating_text: document.querySelector('[data-hook="rating-out-of-text"]')?.textContent || '',
      total_review_count_text: document.querySelector('[data-hook="total-review-count"]')?.textContent || '',
      qa_links: Array.from(document.querySelectorAll('a[href*="ask/questions"]')).map((anchor) => anchor.href || ''),
      review_samples: Array.from(document.querySelectorAll('[data-hook="review"]')).slice(0, ${limit}).map((card) => ({
        title: card.querySelector('[data-hook="review-title"]')?.textContent || '',
        rating_text:
          card.querySelector('[data-hook="review-star-rating"]')?.textContent
          || card.querySelector('[data-hook="cmps-review-star-rating"]')?.textContent
          || '',
        author: card.querySelector('.a-profile-name')?.textContent || '',
        date_text: card.querySelector('[data-hook="review-date"]')?.textContent || '',
        body: card.querySelector('[data-hook="review-body"]')?.textContent || '',
        verified: !!card.querySelector('[data-hook="avp-badge"]'),
      })),
    }))()
  `) as DiscussionPayload;
}

cli({
  site: 'amazon',
  name: 'discussion',
  description: 'Amazon review summary and sample customer discussion from product review pages',
  domain: 'amazon.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: 'ASIN or product URL, for example B0FJS72893',
    },
    {
      name: 'limit',
      type: 'int',
      default: 10,
      help: 'Maximum number of review samples to return (default 10)',
    },
  ],
  columns: ['asin', 'average_rating_value', 'total_review_count'],
  func: async (page, kwargs) => {
    const input = String(kwargs.input ?? '');
    const limit = Math.max(1, Number(kwargs.limit) || 10);
    const payload = await readDiscussionPayload(page, input, limit);
    const normalized = normalizeDiscussionPayload(payload);

    if (!normalized.average_rating_text && !normalized.total_review_count_text) {
      throw new CommandExecutionError(
        'amazon discussion page did not expose review summary',
        'The review page may have changed or hit a robot check. Open the review page in Chrome and retry.',
      );
    }

    return [normalized];
  },
});

export const __test__ = {
  normalizeDiscussionPayload,
};
