import { describe, expect, it } from 'vitest';
import { __test__ } from './utils.js';

const { computeEngagementScore, applyTopByEngagement, ENGAGEMENT_WEIGHTS } = __test__;

describe('computeEngagementScore', () => {
    it('returns 0 for empty / nullish rows', () => {
        expect(computeEngagementScore(null)).toBe(0);
        expect(computeEngagementScore(undefined)).toBe(0);
        expect(computeEngagementScore({})).toBe(0);
    });

    it('weights likes ×1', () => {
        expect(computeEngagementScore({ likes: 10 })).toBe(10);
    });

    it('weights retweets ×3', () => {
        expect(computeEngagementScore({ retweets: 5 })).toBe(15);
    });

    it('weights replies ×2', () => {
        expect(computeEngagementScore({ replies: 4 })).toBe(8);
    });

    it('weights bookmarks ×5', () => {
        expect(computeEngagementScore({ bookmarks: 6 })).toBe(30);
    });

    it('log-dampens views (log10(v+1) × 0.5)', () => {
        // log10(99+1) * 0.5 = 1.0
        expect(computeEngagementScore({ views: 99 })).toBeCloseTo(1.0, 2);
        // log10(0+1) * 0.5 = 0
        expect(computeEngagementScore({ views: 0 })).toBe(0);
    });

    it('coerces string-typed views (search/timeline returns views as a string)', () => {
        // log10(9999+1) * 0.5 = 2.0
        expect(computeEngagementScore({ views: '9999' })).toBeCloseTo(2.0, 2);
    });

    it('treats non-numeric strings as 0 instead of NaN-poisoning the score', () => {
        expect(computeEngagementScore({ likes: 'abc', retweets: 5 })).toBe(15);
    });

    it('clamps negative values at 0 (defensive against bogus payloads)', () => {
        expect(computeEngagementScore({ likes: -100, retweets: 2 })).toBe(6);
    });

    it('combines all signals additively', () => {
        // likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5
        // 10 + 30 + 8 + 25 + log10(1000)*0.5 = 73 + 1.5 = 74.5
        const row = { likes: 10, retweets: 10, replies: 4, bookmarks: 5, views: 999 };
        expect(computeEngagementScore(row)).toBeCloseTo(74.5, 2);
    });

    it('rounds to 2 decimal places for stable test fixtures', () => {
        // log10(1+1) * 0.5 = 0.5 * log10(2) ≈ 0.150515
        const score = computeEngagementScore({ views: 1 });
        expect(score).toBe(0.15);
    });

    it('handles real search-row shape (no replies/bookmarks columns)', () => {
        const searchRow = {
            id: '123',
            author: 'alice',
            text: 'hi',
            likes: 100,
            views: '9999',
        };
        // 100 + log10(10000)*0.5 = 100 + 2.0 = 102.0
        expect(computeEngagementScore(searchRow)).toBeCloseTo(102.0, 2);
    });

    it('handles real bookmarks-row shape (no views/replies columns)', () => {
        const bookmarkRow = {
            id: '123',
            author: 'alice',
            text: 'hi',
            likes: 50,
            retweets: 10,
            bookmarks: 3,
        };
        // 50 + 30 + 15 = 95
        expect(computeEngagementScore(bookmarkRow)).toBe(95);
    });

    it('exposes the documented weight table', () => {
        expect(ENGAGEMENT_WEIGHTS).toEqual({
            likes: 1,
            retweets: 3,
            replies: 2,
            bookmarks: 5,
            viewsLog: 0.5,
        });
    });
});

describe('applyTopByEngagement', () => {
    const rows = [
        { id: 'a', likes: 10 },
        { id: 'b', likes: 50 },
        { id: 'c', likes: 30 },
        { id: 'd', likes: 100 },
        { id: 'e', likes: 5 },
    ];

    it('returns rows unchanged when topN is 0 (default)', () => {
        expect(applyTopByEngagement(rows, 0)).toBe(rows);
    });

    it('returns rows unchanged when topN is negative', () => {
        expect(applyTopByEngagement(rows, -3)).toBe(rows);
    });

    it('returns rows unchanged when topN is non-numeric', () => {
        expect(applyTopByEngagement(rows, 'foo')).toBe(rows);
        expect(applyTopByEngagement(rows, null)).toBe(rows);
        expect(applyTopByEngagement(rows, undefined)).toBe(rows);
    });

    it('sorts descending by score and trims to top N when topN > 0', () => {
        const result = applyTopByEngagement(rows, 3);
        expect(result.map(r => r.id)).toEqual(['d', 'b', 'c']);
    });

    it('returns all rows when topN exceeds row count', () => {
        const result = applyTopByEngagement(rows, 99);
        expect(result.map(r => r.id)).toEqual(['d', 'b', 'c', 'a', 'e']);
    });

    it('floors fractional topN', () => {
        const result = applyTopByEngagement(rows, 2.9);
        expect(result.map(r => r.id)).toEqual(['d', 'b']);
    });

    it('is stable for ties (preserves original order)', () => {
        const tieRows = [
            { id: 'first', likes: 10 },
            { id: 'second', likes: 10 },
            { id: 'third', likes: 10 },
            { id: 'fourth', likes: 100 },
        ];
        const result = applyTopByEngagement(tieRows, 4);
        // 'fourth' first, then ties retain original order
        expect(result.map(r => r.id)).toEqual(['fourth', 'first', 'second', 'third']);
    });

    it('handles empty / non-array input gracefully', () => {
        expect(applyTopByEngagement([], 5)).toEqual([]);
        expect(applyTopByEngagement(null, 5)).toBeNull();
        expect(applyTopByEngagement(undefined, 5)).toBeUndefined();
    });

    it('does not mutate the input array', () => {
        const before = [...rows];
        applyTopByEngagement(rows, 2);
        expect(rows).toEqual(before);
    });

    it('mixes signals correctly when ranking', () => {
        // bookmark-heavy row should beat like-heavy row even if likes are higher
        const mixed = [
            { id: 'likes-only', likes: 100 },           // score = 100
            { id: 'bookmark-heavy', likes: 30, bookmarks: 20 }, // score = 30 + 100 = 130
        ];
        const result = applyTopByEngagement(mixed, 2);
        expect(result.map(r => r.id)).toEqual(['bookmark-heavy', 'likes-only']);
    });
});
