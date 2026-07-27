import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './discussion.js';
import './discussion.js';
import { createPageMock } from '../test-utils.js';


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

  it('requests the review page on the marketplace the input names', async () => {
    const command = getRegistry().get('amazon/discussion');
    const page = createPageMock([
      {
        href: 'https://www.amazon.co.uk/product-reviews/B0FGCPFY9L',
        title: 'Amazon.co.uk: Example product',
        body_text: 'Customer reviews',
      },
      {
        href: 'https://www.amazon.co.uk/product-reviews/B0FGCPFY9L',
        average_rating_text: '4.4 out of 5',
        total_review_count_text: '40 global ratings',
        review_samples: [],
      },
    ]);

    await command.func(page, { input: 'https://www.amazon.co.uk/product-reviews/B0FGCPFY9L', limit: 1 });

    expect(page.goto.mock.calls[0][0]).toBe('https://www.amazon.co.uk/product-reviews/B0FGCPFY9L');
  });

  it('names the loaded url when neither page exposes a review summary', async () => {
    const command = getRegistry().get('amazon/discussion');
    const emptyPayload = { href: 'https://www.amazon.co.uk/dp/B0FGCPFY9L', average_rating_text: '', total_review_count_text: '', review_samples: [] };
    const page = createPageMock([
      { href: 'https://www.amazon.co.uk/product-reviews/B0FGCPFY9L', title: 'Amazon.co.uk', body_text: 'Customer reviews' },
      emptyPayload,
      { href: 'https://www.amazon.co.uk/dp/B0FGCPFY9L', title: 'Amazon.co.uk', body_text: 'Product' },
      emptyPayload,
    ]);

    await expect(command.func(page, { input: 'https://www.amazon.co.uk/dp/B0FGCPFY9L', limit: 1 }))
      .rejects.toThrow('landed on https://www.amazon.co.uk/dp/B0FGCPFY9L');
  });

  it('points a gated non-US review page at that marketplace, not the US store', async () => {
    const command = getRegistry().get('amazon/discussion');
    const signIn = { href: 'https://www.amazon.co.uk/ap/signin', title: 'Amazon Sign-In', body_text: 'Sign in Create account' };
    const page = createPageMock([
      signIn,
      { href: signIn.href, average_rating_text: '', total_review_count_text: '', review_samples: [] },
      signIn,
    ]);

    await expect(command.func(page, { input: 'https://www.amazon.co.uk/dp/B0FGCPFY9L', limit: 1 }))
      .rejects.toMatchObject({ domain: 'www.amazon.co.uk' });
  });

  it('falls back to the product page when the review page redirects to sign-in', async () => {
    const command = getRegistry().get('amazon/discussion');
    const page = createPageMock([
      {
        href: 'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fproduct-reviews%2FB09HKN2ZRT',
        title: 'Amazon Sign-In',
        body_text: 'Sign in Create account',
      },
      {
        href: 'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fproduct-reviews%2FB09HKN2ZRT',
        average_rating_text: '',
        total_review_count_text: '',
        review_samples: [],
      },
      {
        href: 'https://www.amazon.com/dp/B09HKN2ZRT',
        title: 'Amazon.com: Example product',
        body_text: 'Hello, zejia-wu Reviews',
      },
      {
        href: 'https://www.amazon.com/dp/B09HKN2ZRT',
        average_rating_text: '4.4 out of 5',
        total_review_count_text: '349 global ratings',
        review_samples: [
          {
            title: '5.0 out of 5 stars Perfect for the office',
            rating_text: '5.0 out of 5 stars',
            author: 'Ken',
            date_text: 'Reviewed in the United States on March 19, 2026',
            body: 'Good for the office, no complaints.',
            verified: true,
          },
        ],
      },
    ]);

    const result = await command.func(page, { input: 'B09HKN2ZRT', limit: 1 });

    expect(page.goto.mock.calls.map((call) => call[0])).toEqual([
      'https://www.amazon.com/product-reviews/B09HKN2ZRT',
      'https://www.amazon.com/dp/B09HKN2ZRT',
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        asin: 'B09HKN2ZRT',
        discussion_url: 'https://www.amazon.com/dp/B09HKN2ZRT',
        average_rating_value: 4.4,
        total_review_count: 349,
      }),
    ]);
  });

  it('throws AuthRequiredError when both review and product pages are gated', async () => {
    const command = getRegistry().get('amazon/discussion');
    const authState = {
      href: 'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fproduct-reviews%2FB09HKN2ZRT',
      title: 'Amazon Sign-In',
      body_text: 'Sign in Create account',
    };
    const page = createPageMock([
      authState,
      {
        href: authState.href,
        average_rating_text: '',
        total_review_count_text: '',
        review_samples: [],
      },
      authState,
    ]);

    await expect(command.func(page, { input: 'B09HKN2ZRT', limit: 1 })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('does not treat a public product page with sign-in copy as a gated page', () => {
    expect(__test__.isSignInState({
      href: 'https://www.amazon.com/dp/B09HKN2ZRT',
      title: 'Amazon.com: Example product',
      body_text: 'Hello, sign in Account & Lists Create account',
    })).toBe(false);
  });
});
