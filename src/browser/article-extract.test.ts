import { describe, expect, it } from 'vitest';
import {
  buildExtractArticleJs,
  extractArticle,
  DEFAULT_FALLBACK_SELECTORS,
  type ExtractedArticle,
  type PageLike,
} from './article-extract.js';

function fakePage(response: unknown): PageLike & { lastJs: string | null } {
  const state = { lastJs: null as string | null };
  return {
    lastJs: null,
    async evaluate(js: string) {
      state.lastJs = js;
      Object.assign(this as unknown as { lastJs: string | null }, state);
      return response;
    },
  };
}

describe('buildExtractArticleJs', () => {
  it('embeds Readability + Readerable sources once per evaluation', () => {
    const js = buildExtractArticleJs();
    // Both libs should be inlined (matched by identifying strings from the
    // upstream @mozilla/readability sources).
    expect(js).toContain('function Readability(doc, options)');
    expect(js).toContain('function isProbablyReaderable');
  });

  it('serializes caller-supplied options into the evaluated JS', () => {
    const js = buildExtractArticleJs({
      cleanSelectors: ['.ads', '#banner'],
      fallbackSelectors: ['article', 'body'],
      force: true,
    });
    expect(js).toContain('[".ads","#banner"]');
    expect(js).toContain('["article","body"]');
    expect(js).toContain('const force = true;');
  });

  it('uses the default fallback chain when none is supplied', () => {
    const js = buildExtractArticleJs();
    for (const sel of DEFAULT_FALLBACK_SELECTORS) {
      expect(js).toContain(JSON.stringify(sel));
    }
  });

  it('runs fallback selection against the cleaned clone', () => {
    const js = buildExtractArticleJs({ cleanSelectors: ['.noise'] });
    expect(js).toContain('el = cloneDoc.querySelector(sel);');
    expect(js).not.toContain('el = document.querySelector(sel);');
  });

  it('produces syntactically valid JavaScript', () => {
    // Parsing via the Function constructor rejects any syntax error in the
    // generated code — including accidental template-literal break-outs from
    // the embedded Readability sources.
    expect(() => new Function(buildExtractArticleJs())).not.toThrow();
    expect(() => new Function(buildExtractArticleJs({ force: true }))).not.toThrow();
    expect(() => new Function(buildExtractArticleJs({
      cleanSelectors: ['.a', '.b'],
      fallbackSelectors: ['main', 'body'],
    }))).not.toThrow();
  });
});

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
