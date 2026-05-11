import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildProductUrl, buildDiscussionUrl, buildProvenance, cleanText, extractAsin, normalizeProductUrl, parseRatingValue, parseReviewCount, trimRatingPrefix, uniqueNonEmpty, assertUsableState, gotoAndReadState, } from './shared.js';
function normalizeDiscussionPayload(payload) {
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
function hasDiscussionSummary(payload) {
    return Boolean(cleanText(payload.average_rating_text) || cleanText(payload.total_review_count_text));
}
function isSignInState(state) {
    const href = cleanText(state.href).toLowerCase();
    const title = cleanText(state.title).toLowerCase();
    return href.includes('/ap/signin')
        || title.includes('amazon sign-in');
}
async function readCurrentDiscussionPayload(page, limit) {
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
  `);
}
async function readDiscussionPayload(page, input, limit) {
    const reviewUrl = buildDiscussionUrl(input);
    const reviewState = await gotoAndReadState(page, reviewUrl, 2500, 'discussion');
    assertUsableState(reviewState, 'discussion');
    const reviewPayload = await readCurrentDiscussionPayload(page, limit);
    if (hasDiscussionSummary(reviewPayload)) {
        return reviewPayload;
    }
    const productUrl = buildProductUrl(input);
    const productState = await gotoAndReadState(page, productUrl, 2500, 'discussion');
    assertUsableState(productState, 'discussion');
    if (isSignInState(reviewState) && isSignInState(productState)) {
        throw new AuthRequiredError('amazon.com', 'Amazon review discussion requires an active signed-in Amazon session in the shared Chrome profile.');
    }
    const productPayload = await readCurrentDiscussionPayload(page, limit);
    if (hasDiscussionSummary(productPayload)) {
        return productPayload;
    }
    if (isSignInState(reviewState)) {
        throw new CommandExecutionError('amazon review page redirected to sign-in and product page fallback did not expose review summary', 'Open the product page in Chrome, verify reviews are visible, and retry.');
    }
    return reviewPayload;
}
cli({
    site: 'amazon',
    name: 'discussion',
    access: 'read',
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
            throw new CommandExecutionError('amazon discussion page did not expose review summary', 'The review page may have changed or hit a robot check. Open the review page in Chrome and retry.');
        }
        return [normalized];
    },
});
export const __test__ = {
    normalizeDiscussionPayload,
    hasDiscussionSummary,
    isSignInState,
};
