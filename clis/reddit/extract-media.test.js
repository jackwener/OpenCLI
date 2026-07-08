/**
 * Behavioral tests for the extractRedditMedia helper.
 *
 * The helper is duplicated inline inside each adapter's browser-side evaluate()
 * source (see popular.js / hot.js / search.js / frontpage.js / subreddit.js).
 * Per-adapter tests grep that the same function-name + spread call is present.
 * This file pins the helper's behavior against representative Reddit-JSON
 * fixtures.
 */
import { describe, expect, it } from 'vitest';

function decodeHtml(s) {
  if (typeof s !== 'string' || !s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'");
}
function extractRedditMedia(d) {
  const post_hint = d?.post_hint || '';
  const url_overridden_by_dest = d?.url_overridden_by_dest || '';
  const preview_image_url = decodeHtml(d?.preview?.images?.[0]?.source?.url || '');
  const gallery_urls = [];
  const items = d?.gallery_data?.items;
  const meta = d?.media_metadata;
  if (Array.isArray(items) && meta) {
    for (const it of items) {
      const m = it && meta[it.media_id];
      const u = m?.s?.u;
      if (u) gallery_urls.push(decodeHtml(u));
    }
  }
  return { post_hint, url_overridden_by_dest, preview_image_url, gallery_urls };
}

describe('extractRedditMedia', () => {
  it('returns empty fields for a plain text/self post', () => {
    expect(extractRedditMedia({ is_self: true, selftext: 'hi' })).toEqual({
      post_hint: '',
      url_overridden_by_dest: '',
      preview_image_url: '',
      gallery_urls: [],
    });
  });

  it('extracts post_hint, url_overridden_by_dest, preview_image_url for a single-image post', () => {
    const post = {
      post_hint: 'image',
      url_overridden_by_dest: 'https://i.redd.it/abc.jpg',
      preview: {
        images: [{ source: { url: 'https://preview.redd.it/abc.jpg?width=640&amp;s=xyz' } }],
      },
    };
    expect(extractRedditMedia(post)).toEqual({
      post_hint: 'image',
      url_overridden_by_dest: 'https://i.redd.it/abc.jpg',
      preview_image_url: 'https://preview.redd.it/abc.jpg?width=640&s=xyz',
      gallery_urls: [],
    });
  });

  it('extracts gallery_urls in gallery_data.items order, HTML-decoded', () => {
    const post = {
      post_hint: '',
      url_overridden_by_dest: 'https://www.reddit.com/gallery/xyz',
      gallery_data: {
        items: [{ media_id: 'idB' }, { media_id: 'idA' }, { media_id: 'idC' }],
      },
      media_metadata: {
        idA: { s: { u: 'https://preview.redd.it/idA.jpg?width=1&amp;a=1' } },
        idB: { s: { u: 'https://preview.redd.it/idB.jpg?width=1&amp;a=2' } },
        idC: { s: { u: 'https://preview.redd.it/idC.jpg?width=1&amp;a=3' } },
      },
    };
    const out = extractRedditMedia(post);
    expect(out.gallery_urls).toEqual([
      'https://preview.redd.it/idB.jpg?width=1&a=2',
      'https://preview.redd.it/idA.jpg?width=1&a=1',
      'https://preview.redd.it/idC.jpg?width=1&a=3',
    ]);
    expect(out.url_overridden_by_dest).toBe('https://www.reddit.com/gallery/xyz');
  });

  it('extracts post_hint for a hosted:video post', () => {
    const post = {
      post_hint: 'hosted:video',
      url_overridden_by_dest: 'https://v.redd.it/xyz',
      preview: { images: [{ source: { url: 'https://preview.redd.it/thumb.jpg' } }] },
    };
    const out = extractRedditMedia(post);
    expect(out.post_hint).toBe('hosted:video');
    expect(out.url_overridden_by_dest).toBe('https://v.redd.it/xyz');
    expect(out.preview_image_url).toBe('https://preview.redd.it/thumb.jpg');
    expect(out.gallery_urls).toEqual([]);
  });

  it('extracts post_hint for an external link post', () => {
    const post = {
      post_hint: 'link',
      url_overridden_by_dest: 'https://example.com/article',
    };
    expect(extractRedditMedia(post)).toEqual({
      post_hint: 'link',
      url_overridden_by_dest: 'https://example.com/article',
      preview_image_url: '',
      gallery_urls: [],
    });
  });

  it('HTML-decodes preview URLs that arrive with &amp; separators', () => {
    const post = {
      preview: {
        images: [{ source: { url: 'https://x/?a=1&amp;b=2&amp;c=3' } }],
      },
    };
    expect(extractRedditMedia(post).preview_image_url).toBe('https://x/?a=1&b=2&c=3');
  });

  it('skips gallery entries whose media_metadata is missing', () => {
    const post = {
      gallery_data: { items: [{ media_id: 'present' }, { media_id: 'orphan' }] },
      media_metadata: {
        present: { s: { u: 'https://preview.redd.it/present.jpg' } },
        // 'orphan' intentionally absent
      },
    };
    expect(extractRedditMedia(post).gallery_urls).toEqual([
      'https://preview.redd.it/present.jpg',
    ]);
  });

  it('tolerates null/undefined input without throwing', () => {
    expect(extractRedditMedia(null)).toEqual({
      post_hint: '',
      url_overridden_by_dest: '',
      preview_image_url: '',
      gallery_urls: [],
    });
    expect(extractRedditMedia(undefined)).toEqual({
      post_hint: '',
      url_overridden_by_dest: '',
      preview_image_url: '',
      gallery_urls: [],
    });
  });
});
