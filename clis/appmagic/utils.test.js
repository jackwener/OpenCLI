import { describe, expect, it } from 'vitest';

import { BUCKET_SENTINEL_CEILING, decodeBucket, GAMES_DOMAIN_TAG, pickGamesGenre } from './utils.js';

// appmagic encodes the bucket DIRECTION inside the number itself, so the raw
// value is not the value: 0 means "no data" (the UI renders an em dash) and 1
// means "nonzero but under 5,000" (the UI renders "< 5,000"). A "simplification"
// back to the raw number silently reports a no-data app as earning 0 and a
// sub-$5,000 app as earning $1 — plausible-looking and wrong. Expectations are
// pinned to values observed live for the search query "knit away".
describe('decodeBucket (free-tier bucket encoding)', () => {
  it('treats 0 as "no data", not zero', () => {
    expect(decodeBucket(0)).toEqual({ min: null, max: null });
  });

  it('treats a missing field as "no data"', () => {
    expect(decodeBucket(null)).toEqual({ min: null, max: null });
    expect(decodeBucket(undefined)).toEqual({ min: null, max: null });
  });

  it('treats 1 as the "< 5,000" sentinel — an UPPER bound, not $1', () => {
    // Live: "Wool Sort: Knit Away" revenue=1 renders as "< $5,000".
    expect(decodeBucket(1)).toEqual({ min: null, max: BUCKET_SENTINEL_CEILING });
    expect(BUCKET_SENTINEL_CEILING).toBe(5000);
  });

  it('treats any other value as a LOWER bound', () => {
    // Live: "Wool Crush" revenue=500000 -> "> $500,000"; downloads=2000000 -> "> 2,000,000".
    expect(decodeBucket(500000)).toEqual({ min: 500000, max: null });
    expect(decodeBucket(2000000)).toEqual({ min: 2000000, max: null });
    // The bucket edge itself is a lower bound, NOT the 1-sentinel.
    expect(decodeBucket(5000)).toEqual({ min: 5000, max: null });
  });

  it('never sets both bounds (buckets are open-ended on one side)', () => {
    for (const raw of [0, 1, 5000, 10000, 500000, 2000000, 20000000]) {
      const { min, max } = decodeBucket(raw);
      expect(min === null || max === null).toBe(true);
    }
  });

  it('decodes the full "knit away" search panel as the UI renders it', () => {
    const rows = [
      { revenue: 500000, expect: { min: 500000, max: null } }, // "> $500,000"
      { revenue: 200000, expect: { min: 200000, max: null } }, // "> $200,000"
      { revenue: 50000, expect: { min: 50000, max: null } }, // "> $50,000"
      { revenue: 1, expect: { min: null, max: 5000 } }, // "< $5,000"
      { revenue: 0, expect: { min: null, max: null } }, // "—"
    ];
    for (const row of rows) expect(decodeBucket(row.revenue)).toEqual(row.expect);
  });
});

// pickGamesGenre chooses the tightest competitive genre from an app's tags: the
// leaf games-type tag (one no other games tag lists as a parent), falling back
// to the Games domain when the app has no games sub-genre.
describe('pickGamesGenre (competitive genre selection)', () => {
  it('falls back to the Games domain when there is no games sub-genre', () => {
    expect(pickGamesGenre([{ id: 9, name: 'Apps', type: 'domain' }])).toEqual(GAMES_DOMAIN_TAG);
    expect(pickGamesGenre([])).toEqual(GAMES_DOMAIN_TAG);
    expect(pickGamesGenre(null)).toEqual(GAMES_DOMAIN_TAG);
  });

  it('picks the leaf (most specific) games tag over its ancestors', () => {
    // Wool Sort: Knit Away's real chain — 78 Puzzle -> 243367 Block Puzzle ->
    // 243820 Slide -> 243881 Slide: Other. The leaf is "Slide: Other".
    const tags = [
      { id: 3, name: 'Games', type: 'domain', parent_ids: [] },
      { id: 78, name: 'Puzzle', type: 'games', parent_ids: [] },
      { id: 243367, name: 'Block Puzzle', type: 'games', parent_ids: [78] },
      { id: 243820, name: 'Slide', type: 'games', parent_ids: [243367] },
      { id: 243881, name: 'Slide: Other', type: 'games', parent_ids: [243820] },
      { id: 243425, name: 'Stylized', type: 'artstyles', parent_ids: [] },
    ];
    expect(pickGamesGenre(tags)).toEqual({ id: 243881, name: 'Slide: Other' });
  });

  it('accepts a "-"-joined parent_ids string (top-charts shape)', () => {
    const tags = [
      { id: 78, name: 'Puzzle', type: 'games', parent_ids: '' },
      { id: 243367, name: 'Block Puzzle', type: 'games', parent_ids: '78' },
    ];
    expect(pickGamesGenre(tags)).toEqual({ id: 243367, name: 'Block Puzzle' });
  });
});
