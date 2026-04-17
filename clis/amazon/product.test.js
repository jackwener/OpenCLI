import { describe, expect, it } from 'vitest';
import { __test__ } from './product.js';
describe('amazon product normalization', () => {
    it('normalizes product facts from the product page', () => {
        const result = __test__.normalizeProductPayload({
            href: 'https://www.amazon.com/dp/B0FJS72893',
            title: 'Amazon.com: KVTUKIAIT Desktop Shelf Organizer',
            product_title: 'White Desktop Shelf Organizer for Top of Desk',
            byline: 'Visit the KVTUKIAIT Store',
            price_text: '$15.99',
            rating_text: '3.9 out of 5 stars',
            review_count_text: '27 ratings',
            review_url: 'https://www.amazon.com/dp/B0FJS72893#customerReviews',
            qa_url: null,
            bullets: ['SPACE-SAVING DESK SHELF ORGANIZER', 'SMALL AND STYLISH AESTHETIC DECOR'],
            breadcrumbs: ['Office Products', 'Desktop & Off-Surface Shelves'],
        });
        expect(result.asin).toBe('B0FJS72893');
        expect(result.price_value).toBe(15.99);
        expect(result.rating_value).toBe(3.9);
        expect(result.review_count).toBe(27);
        expect(result.breadcrumbs).toEqual(['Office Products', 'Desktop & Off-Surface Shelves']);
    });
});
