import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './image.js';

describe('grok image helpers', () => {
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

  describe('normalizePositiveInteger', () => {
    it('returns a parsed positive integer', () => {
      expect(__test__.normalizePositiveInteger(3, 1, 'count')).toBe(3);
      expect(__test__.normalizePositiveInteger('5', 1, 'count')).toBe(5);
    });

    it('falls back to the default when the user did not pass a value', () => {
      expect(__test__.normalizePositiveInteger(undefined, 1, 'count')).toBe(1);
      expect(__test__.normalizePositiveInteger(null, 4, 'count')).toBe(4);
    });

    it('throws ArgumentError instead of silently clamping out-of-range input', () => {
      expect(() => __test__.normalizePositiveInteger(0, 1, 'count')).toThrow(ArgumentError);
      expect(() => __test__.normalizePositiveInteger(-1, 1, 'count')).toThrow(ArgumentError);
      expect(() => __test__.normalizePositiveInteger(1.5, 1, 'count')).toThrow(ArgumentError);
      expect(() => __test__.normalizePositiveInteger('not-a-number', 1, 'count')).toThrow(ArgumentError);
    });
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
