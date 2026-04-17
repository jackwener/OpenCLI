import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildProductUrl, buildProvenance, cleanText, extractAsin, PRIMARY_PRICE_SELECTORS, parsePriceText, parseRatingValue, parseReviewCount, normalizeProductUrl, uniqueNonEmpty, assertUsableState, gotoAndReadState, } from './shared.js';
const PRODUCT_TITLE_SELECTOR = '#productTitle, #title span, [data-feature-name="title"] h1 span';
const BYLINE_SELECTOR = '#bylineInfo, [data-feature-name="bylineInfo"] #bylineInfo';
function normalizeProductPayload(payload) {
    const sourceUrl = cleanText(payload.href) || buildProductUrl(cleanText(payload.product_title) || cleanText(payload.href));
    const asin = extractAsin(payload.href ?? '') ?? null;
    const price = parsePriceText(payload.price_text);
    const ratingText = cleanText(payload.rating_text) || null;
    const reviewCountText = cleanText(payload.review_count_text) || null;
    const provenance = buildProvenance(sourceUrl);
    return {
        asin,
        title: cleanText(payload.product_title) || cleanText(payload.title) || null,
        product_url: normalizeProductUrl(payload.href),
        ...provenance,
        brand_text: cleanText(payload.byline) || null,
        price_text: price.price_text,
        price_value: price.price_value,
        currency: price.currency,
        rating_text: ratingText,
        rating_value: parseRatingValue(ratingText),
        review_count_text: reviewCountText,
        review_count: parseReviewCount(reviewCountText),
        review_url: cleanText(payload.review_url) || null,
        qa_url: cleanText(payload.qa_url) || null,
        breadcrumbs: uniqueNonEmpty(payload.breadcrumbs ?? []),
        bullet_points: uniqueNonEmpty(payload.bullets ?? []),
    };
}
async function readProductPayload(page, input) {
    const url = buildProductUrl(input);
    const state = await gotoAndReadState(page, url, 2500, 'product');
    assertUsableState(state, 'product');
    // Amazon can report a "stable" DOM before the product title block hydrates,
    // especially when reconnecting to an existing shared CDP target.
    await page.wait({ selector: PRODUCT_TITLE_SELECTOR, timeout: 6 }).catch(() => { });
    return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      product_title: document.querySelector(${JSON.stringify(PRODUCT_TITLE_SELECTOR)})?.textContent || '',
      byline: document.querySelector(${JSON.stringify(BYLINE_SELECTOR)})?.textContent || '',
      price_text: (() => {
        const selectors = ${JSON.stringify(PRIMARY_PRICE_SELECTORS)};
        for (const selector of selectors) {
          const text = document.querySelector(selector)?.textContent || '';
          if (text.trim()) return text;
        }
        return '';
      })(),
      rating_text:
        document.querySelector('#acrPopover')?.getAttribute('title')
        || document.querySelector('#acrPopover')?.textContent
        || '',
      review_count_text: document.querySelector('#acrCustomerReviewText')?.textContent || '',
      review_url: document.querySelector('a[href*="#customerReviews"]')?.href || '',
      qa_url: document.querySelector('a[href*="ask/questions"]')?.href || '',
      bullets: Array.from(document.querySelectorAll('#feature-bullets li .a-list-item')).map((node) => node.textContent || ''),
      breadcrumbs: Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a')).map((node) => node.textContent || ''),
    }))()
  `);
}
cli({
    site: 'amazon',
    name: 'product',
    description: 'Amazon product page facts for candidate validation',
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
    ],
    columns: ['asin', 'title', 'price_text', 'rating_value', 'review_count'],
    func: async (page, kwargs) => {
        const input = String(kwargs.input ?? '');
        const payload = await readProductPayload(page, input);
        if (!cleanText(payload.product_title)) {
            throw new CommandExecutionError('amazon product page did not expose product content', 'The product page may have changed or hit a robot check. Open the product page in Chrome and retry.');
        }
        return [normalizeProductPayload(payload)];
    },
});
export const __test__ = {
    normalizeProductPayload,
};
