import { describe, expect, it } from 'vitest';

import { __test__ } from './discussion.js';

describe('amazon discussion normalization', () => {
  it('normalizes review summary and sample reviews', () => {
    const result = __test__.normalizeDiscussionPayload({
      href: 'https://www.amazon.com/product-reviews/B0FJS72893',
      average_rating_text: '3.9 out of 5',
      total_review_count_text: '27 global ratings',
      qa_links: [],
      review_samples: [
        {
          title: '5.0 out of 5 stars Great value and quality',
          rating_text: '5.0 out of 5 stars',
          author: 'GTreader2',
          date_text: 'Reviewed in the United States on February 21, 2026',
          body: 'Small but mighty.',
          verified: true,
        },
      ],
    });

    expect(result.asin).toBe('B0FJS72893');
    expect(result.average_rating_value).toBe(3.9);
    expect(result.total_review_count).toBe(27);
    expect(result.review_samples).toEqual([
      {
        title: 'Great value and quality',
        rating_text: '5.0 out of 5 stars',
        rating_value: 5,
        author: 'GTreader2',
        date_text: 'Reviewed in the United States on February 21, 2026',
        body: 'Small but mighty.',
        verified_purchase: true,
      },
    ]);
  });

  it('keeps the review marketplace in every emitted url', () => {
    const result = __test__.normalizeDiscussionPayload({
      href: 'https://www.amazon.co.uk/product-reviews/B0FGCPFY9L',
      average_rating_text: '4.4 out of 5',
      total_review_count_text: '40 global ratings',
      qa_links: [],
      review_samples: [],
    });

    expect(result.asin).toBe('B0FGCPFY9L');
    expect(result.discussion_url).toBe('https://www.amazon.co.uk/product-reviews/B0FGCPFY9L');
    expect(result.product_url).toBe('https://www.amazon.co.uk/dp/B0FGCPFY9L');
  });

  it('does not treat a public product page with sign-in copy as a gated page', () => {
    expect(__test__.isSignInState({
      href: 'https://www.amazon.com/dp/B09HKN2ZRT',
      title: 'Amazon.com: Example product',
      body_text: 'Hello, sign in Account & Lists Create account',
    })).toBe(false);
  });
});
