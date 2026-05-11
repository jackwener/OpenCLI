import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildProvenance, buildSearchUrl, cleanText, extractAsin, normalizeProductUrl, parsePriceText, parseRatingValue, parseReviewCount, assertUsableState, gotoAndReadState, } from './shared.js';
function normalizeSearchCandidate(candidate, rank, sourceUrl) {
    const productUrl = normalizeProductUrl(candidate.href);
    const asin = extractAsin(candidate.asin ?? '') ?? extractAsin(productUrl ?? '') ?? null;
    const price = parsePriceText(candidate.price_text);
    const ratingText = cleanText(candidate.rating_text) || null;
    const reviewCountText = cleanText(candidate.review_count_text) || null;
    const provenance = buildProvenance(sourceUrl);
    return {
        rank,
        asin,
        title: cleanText(candidate.title) || null,
        product_url: productUrl,
        ...provenance,
        price_text: price.price_text,
        price_value: price.price_value,
        currency: price.currency,
        rating_text: ratingText,
        rating_value: parseRatingValue(ratingText),
        review_count_text: reviewCountText,
        review_count: parseReviewCount(reviewCountText),
        is_sponsored: candidate.sponsored === true,
        badges: (candidate.badge_texts ?? []).map((value) => cleanText(value)).filter(Boolean),
    };
}
async function readSearchPayload(page, query) {
    const url = buildSearchUrl(query);
    const state = await gotoAndReadState(page, url, 2500, 'search');
    assertUsableState(state, 'search');
    return await page.evaluate(`
    (() => ({
      href: window.location.href,
      cards: Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'))
        .map((card) => ({
          asin: card.getAttribute('data-asin') || '',
          title: card.querySelector('h2')?.textContent || '',
          href: card.querySelector('a.a-link-normal[href*="/dp/"]')?.href || '',
          price_text: card.querySelector('.a-price .a-offscreen')?.textContent || '',
          rating_text: card.querySelector('[aria-label*="out of 5 stars"]')?.getAttribute('aria-label') || '',
          review_count_text: card.querySelector('a[href*="#customerReviews"]')?.textContent || '',
          sponsored: /sponsored/i.test(card.innerText || ''),
          badge_texts: Array.from(card.querySelectorAll('.a-badge-text')).map((node) => node.textContent || ''),
        })),
    }))()
  `);
}
cli({
    site: 'amazon',
    name: 'search',
    access: 'read',
    description: 'Amazon search results for product discovery and coarse filtering',
    domain: 'amazon.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        {
            name: 'query',
            required: true,
            positional: true,
            help: 'Search query, for example "desk shelf organizer"',
        },
        {
            name: 'limit',
            type: 'int',
            default: 20,
            help: 'Maximum number of results to return (default 20)',
        },
    ],
    columns: ['rank', 'asin', 'title', 'price_text', 'rating_value', 'review_count'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query ?? '');
        const limit = Math.max(1, Number(kwargs.limit) || 20);
        const payload = await readSearchPayload(page, query);
        const sourceUrl = cleanText(payload.href) || buildSearchUrl(query);
        const cards = (payload.cards ?? [])
            .filter((card) => cleanText(card.asin) && cleanText(card.title))
            .slice(0, limit);
        if (cards.length === 0) {
            throw new CommandExecutionError('amazon search did not expose any product cards', 'The search page may have changed or hit a robot check. Open the same query in Chrome, verify the page is visible, and retry.');
        }
        return cards.map((card, index) => normalizeSearchCandidate(card, index + 1, sourceUrl));
    },
});
export const __test__ = {
    normalizeSearchCandidate,
};
