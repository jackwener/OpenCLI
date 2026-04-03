import { describe, expect, it } from 'vitest';
import { __test__ } from './bestsellers.js';

describe('amazon bestsellers normalization', () => {
  it('normalizes bestseller cards and infers review counts from card text', () => {
    const result = __test__.normalizeBestsellerCandidate({
      asin: 'B0DR31GC3D',
      title: '',
      href: 'https://www.amazon.com/NUTIKAS-Shelves-Desktop-Orgnizer-Shlef/dp/B0DR31GC3D/ref=zg_bs',
      price_text: '$25.92',
      rating_text: '4.3 out of 5 stars',
      review_count_text: '',
      card_text: 'Desk Shelves Desktop Organizer Shlef\n4.3 out of 5 stars\n435\n$25.92',
    }, 2, 'Amazon Best Sellers: Best Desktop & Off-Surface Shelves', 'https://www.amazon.com/example');

    expect(result.rank).toBe(2);
    expect(result.asin).toBe('B0DR31GC3D');
    expect(result.title).toBe('Desk Shelves Desktop Organizer Shlef');
    expect(result.review_count).toBe(435);
    expect(result.list_title).toBe('Amazon Best Sellers: Best Desktop & Off-Surface Shelves');
  });
});
