import { describe, expect, it } from 'vitest';
import {
  extractArticle,
  type ExtractedArticle,
  type PageLike,
} from './article-extract.js';

function fakePage(response: unknown): PageLike {
  return { evaluate: async () => response };
}

describe('extractArticle (host-side)', () => {
  it('returns a normalized ExtractedArticle when the page responds with one', async () => {
    const page = fakePage({
      source: 'readability',
      html: '<p>hello</p>',
      title: 'Hello',
      byline: 'Alice',
      publishedTime: '2026-04-22',
      siteName: 'Example',
    });
    const res = await extractArticle(page);
    expect(res).toEqual<ExtractedArticle>({
      source: 'readability',
      html: '<p>hello</p>',
      title: 'Hello',
      byline: 'Alice',
      publishedTime: '2026-04-22',
      siteName: 'Example',
    });
  });

  it('drops undefined optional fields cleanly', async () => {
    const page = fakePage({ source: 'fallback', html: '<main>x</main>', title: 't' });
    const res = await extractArticle(page);
    expect(res).toEqual({ source: 'fallback', html: '<main>x</main>', title: 't' });
    expect(res).not.toHaveProperty('byline');
    expect(res).not.toHaveProperty('publishedTime');
  });

  it('returns null on a missing body or malformed payload', async () => {
    expect(await extractArticle(fakePage(null))).toBeNull();
    expect(await extractArticle(fakePage('oops'))).toBeNull();
    expect(await extractArticle(fakePage({ source: 'readability' }))).toBeNull();
    expect(await extractArticle(fakePage({ html: '<p>x</p>' }))).toBeNull();
  });

  it('defaults title to empty string when the page omits it', async () => {
    const page = fakePage({ source: 'pre', html: '<body><pre>x</pre></body>' });
    const res = await extractArticle(page);
    expect(res?.title).toBe('');
    expect(res?.source).toBe('pre');
  });
});
