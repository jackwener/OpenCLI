import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('amazon search normalization', () => {
  it('normalizes search cards into research-friendly fields', () => {
    const result = __test__.normalizeSearchCandidate({
      asin: 'B0FJS72893',
      title: 'White Desktop Shelf Organizer for Top of Desk',
      href: 'https://www.amazon.com/KVTUKIAIT-White-Desktop-Shelf-Organizer/dp/B0FJS72893/ref=sr_1_1',
      price_text: '$15.99',
      rating_text: '3.9 out of 5 stars, rating details',
      review_count_text: '(27)',
      sponsored: false,
      badge_texts: ['Limited time deal'],
    }, 1, 'https://www.amazon.com/s?k=desk+shelf+organizer');

    expect(result.asin).toBe('B0FJS72893');
    expect(result.product_url).toBe('https://www.amazon.com/dp/B0FJS72893');
    expect(result.price_value).toBe(15.99);
    expect(result.rating_value).toBe(3.9);
    expect(result.review_count).toBe(27);
    expect(result.badges).toEqual(['Limited time deal']);
  });
});
