import { describe, expect, it } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';
import { __test__ } from './image.js';

describe('grok image helpers', () => {
  describe('isOnGrok', () => {
    const fakePage = (url: string | Error): IPage =>
      ({ evaluate: () => url instanceof Error ? Promise.reject(url) : Promise.resolve(url) }) as unknown as IPage;

    it('returns true for grok.com URLs', async () => {
      expect(await __test__.isOnGrok(fakePage('https://grok.com/'))).toBe(true);
      expect(await __test__.isOnGrok(fakePage('https://grok.com/chat/abc123'))).toBe(true);
    });

    it('returns true for grok.com subdomains', async () => {
      expect(await __test__.isOnGrok(fakePage('https://assets.grok.com/foo'))).toBe(true);
    });

    it('returns false for non-grok domains', async () => {
      expect(await __test__.isOnGrok(fakePage('https://fakegrok.com/'))).toBe(false);
      expect(await __test__.isOnGrok(fakePage('about:blank'))).toBe(false);
    });

    it('returns false when evaluate throws (detached tab)', async () => {
      expect(await __test__.isOnGrok(fakePage(new Error('detached')))).toBe(false);
    });
  });

  it('normalizes boolean flags', () => {
    expect(__test__.normalizeBooleanFlag(true)).toBe(true);
    expect(__test__.normalizeBooleanFlag('true')).toBe(true);
    expect(__test__.normalizeBooleanFlag('1')).toBe(true);
    expect(__test__.normalizeBooleanFlag('yes')).toBe(true);
    expect(__test__.normalizeBooleanFlag('on')).toBe(true);

    expect(__test__.normalizeBooleanFlag(false)).toBe(false);
    expect(__test__.normalizeBooleanFlag('false')).toBe(false);
    expect(__test__.normalizeBooleanFlag(undefined)).toBe(false);
  });

  it('dedupes images by src', () => {
    const deduped = __test__.dedupeBySrc([
      { src: 'https://a.example/1.jpg', w: 500, h: 500 },
      { src: 'https://a.example/1.jpg', w: 500, h: 500 },
      { src: 'https://a.example/2.jpg', w: 500, h: 500 },
      { src: '', w: 500, h: 500 },
    ]);
    expect(deduped.map(i => i.src)).toEqual([
      'https://a.example/1.jpg',
      'https://a.example/2.jpg',
    ]);
  });

  it('builds a deterministic-ish signature order-independent by src', () => {
    const sigA = __test__.imagesSignature([
      { src: 'https://a.example/1.jpg', w: 1, h: 1 },
      { src: 'https://a.example/2.jpg', w: 1, h: 1 },
    ]);
    const sigB = __test__.imagesSignature([
      { src: 'https://a.example/2.jpg', w: 1, h: 1 },
      { src: 'https://a.example/1.jpg', w: 1, h: 1 },
    ]);
    expect(sigA).toBe(sigB);
  });

  it('maps content-type to sensible image extensions', () => {
    expect(__test__.extFromContentType('image/png')).toBe('png');
    expect(__test__.extFromContentType('image/webp')).toBe('webp');
    expect(__test__.extFromContentType('image/gif')).toBe('gif');
    expect(__test__.extFromContentType('image/jpeg')).toBe('jpg');
    expect(__test__.extFromContentType(undefined)).toBe('jpg');
    expect(__test__.extFromContentType('')).toBe('jpg');
  });

  it('builds filenames with a stable sha1 slice tied to the src', () => {
    const a1 = __test__.buildFilename('https://a.example/1.jpg', 'image/jpeg');
    const a2 = __test__.buildFilename('https://a.example/1.jpg', 'image/jpeg');
    const b1 = __test__.buildFilename('https://a.example/2.jpg', 'image/png');
    // Same URL → same 12-char hash slice (timestamps may differ).
    expect(a1.split('-')[2].split('.')[0]).toBe(a2.split('-')[2].split('.')[0]);
    expect(a1.split('-')[2].split('.')[0]).not.toBe(b1.split('-')[2].split('.')[0]);
    expect(a1.endsWith('.jpg')).toBe(true);
    expect(b1.endsWith('.png')).toBe(true);
  });

  it('only accepts image bubbles that appeared after the baseline', () => {
    const candidate = __test__.pickLatestImageCandidate([
      [{ src: 'https://a.example/stale.jpg', w: 512, h: 512 }],
      [],
      [{ src: 'https://a.example/fresh.jpg', w: 1024, h: 1024 }],
    ], 1);

    expect(candidate).toEqual([
      { src: 'https://a.example/fresh.jpg', w: 1024, h: 1024 },
    ]);
  });

  it('does not reuse stale images when no new image bubble appears after baseline', () => {
    const candidate = __test__.pickLatestImageCandidate([
      [{ src: 'https://a.example/stale.jpg', w: 512, h: 512 }],
      [],
      [],
    ], 1);

    expect(candidate).toEqual([]);
  });
});
