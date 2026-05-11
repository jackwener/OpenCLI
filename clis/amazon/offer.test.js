import { describe, expect, it } from 'vitest';
import { __test__ } from './offer.js';
describe('amazon offer normalization', () => {
    it('extracts sold-by and fulfillment facts from product offer text', () => {
        const result = __test__.normalizeOfferPayload({
            href: 'https://www.amazon.com/dp/B0FJS72893',
            price_text: '$15.99',
            merchant_info: '',
            sold_by: 'KUATUDIRECT',
            ships_from_text: 'Ships from Amazon',
            offer_link: null,
            review_url: 'https://www.amazon.com/dp/B0FJS72893#customerReviews',
            qa_url: null,
        });
        expect(result.asin).toBe('B0FJS72893');
        expect(result.sold_by).toBe('KUATUDIRECT');
        expect(result.ships_from).toBe('Amazon');
        expect(result.is_amazon_sold).toBe(false);
        expect(result.is_amazon_fulfilled).toBe(true);
    });
    it('parses merchant info fallback text', () => {
        expect(__test__.extractSoldBy('Sold by Example Seller and Fulfilled by Amazon.')).toBe('Example Seller');
        expect(__test__.extractShipsFrom('Ships from Amazon')).toBe('Amazon');
    });
    it('detects delivery-location blocking in the buy box text', () => {
        expect(__test__.isDeliveryLocationBlocked('This item cannot be shipped to your selected delivery location. Similar items shipping to Hong Kong')).toBe(true);
        expect(__test__.isDeliveryLocationBlocked('Ships from Amazon')).toBe(false);
    });
});
