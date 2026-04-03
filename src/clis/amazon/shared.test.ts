import { describe, expect, it } from 'vitest';
import { __test__ } from './shared.js';

describe('amazon shared helpers', () => {
  it('builds canonical product and discussion URLs from ASINs and product URLs', () => {
    expect(__test__.buildProductUrl('B0FJS72893')).toBe('https://www.amazon.com/dp/B0FJS72893');
    expect(__test__.buildProductUrl('https://www.amazon.com/dp/B0FJS72893/ref=something')).toBe('https://www.amazon.com/dp/B0FJS72893');
    expect(__test__.buildDiscussionUrl('https://www.amazon.com/dp/B0FJS72893')).toBe('https://www.amazon.com/product-reviews/B0FJS72893');
  });

  it('parses price, rating, and review-count text', () => {
    expect(__test__.parsePriceText('1 offer from $34.11')).toEqual({
      price_text: '$34.11',
      price_value: 34.11,
      currency: 'USD',
    });
    expect(__test__.parseRatingValue('3.9 out of 5 stars, rating details')).toBe(3.9);
    expect(__test__.parseReviewCount('27 global ratings')).toBe(27);
    expect(__test__.parseReviewCount('(2.9K)')).toBe(2900);
    expect(__test__.parseReviewCount('1.2M global ratings')).toBe(1200000);
    expect(__test__.extractReviewCountFromCardText('Desk Shelf\n4.3 out of 5 stars\n435\n$25.92')).toBe('435');
  });

  it('recognizes robot checks and Amazon-owned merchants', () => {
    expect(__test__.isAmazonEntity('Ships from Amazon')).toBe(true);
    expect(__test__.trimRatingPrefix('5.0 out of 5 stars Great value and quality')).toBe('Great value and quality');
    expect(__test__.isRobotState({
      title: 'Robot Check',
      body_text: 'Sorry, we just need to make sure you\'re not a robot',
    })).toBe(true);
  });

  it('requires a real best-sellers URL or path', () => {
    expect(__test__.resolveBestsellersUrl('/Best-Sellers/zgbs')).toBe('https://www.amazon.com/Best-Sellers/zgbs');
    expect(() => __test__.resolveBestsellersUrl('desk shelf organizer')).toThrow('amazon bestsellers expects a best sellers URL or /zgbs path');
  });
});
