import { describe, expect, it } from 'vitest';

const { parseAuthors, durationSeconds, averageRating, parseRow } = await import('./search.js').then((m) => m.__test__);

describe('linkedin-learning search', () => {
    it('joins author first/last names', () => {
        expect(parseAuthors([{ firstName: 'Jane', lastName: 'Doe' }])).toBe('Jane Doe');
        expect(parseAuthors([{ firstName: 'A', lastName: 'B' }, { firstName: 'C', lastName: 'D' }])).toBe('A B, C D');
        expect(parseAuthors([])).toBe('');
        expect(parseAuthors(undefined)).toBe('');
    });

    it('extracts duration from TimeSpan only when unit is SECOND', () => {
        expect(durationSeconds({ 'com.linkedin.common.TimeSpan': { duration: 600, unit: 'SECOND' } })).toBe('600');
        expect(durationSeconds({ 'com.linkedin.common.TimeSpan': { duration: 10, unit: 'MINUTE' } })).toBe('');
        expect(durationSeconds(undefined)).toBe('');
    });

    it('computes average rating from sum/count when averageRating is missing', () => {
        expect(averageRating({ ratingSum: 1165, ratingCount: 259 })).toBe('4.50');
        expect(averageRating({ averageRating: 4.32 })).toBe('4.32');
        expect(averageRating({ ratingSum: 0, ratingCount: 0 })).toBe('');
        expect(averageRating(undefined)).toBe('');
    });

    it('maps a search result element to the canonical row shape', () => {
        const el = {
            entityType: 'COURSE',
            slug: 'agentic-ai-build-your-first-agentic-ai-system',
            headline: { title: { text: 'Agentic AI: Build Your First Agentic AI System' } },
            authors: [{ firstName: 'Aishwarya', lastName: 'Naresh Reganti' }],
            difficultyLevel: 'INTERMEDIATE',
            length: { 'com.linkedin.common.TimeSpan': { duration: 3932, unit: 'SECOND' } },
            rating: { ratingSum: 1165, ratingCount: 259 },
            viewerCount: 25323,
        };
        expect(parseRow(el, 1)).toEqual({
            rank: 1,
            type: 'COURSE',
            title: 'Agentic AI: Build Your First Agentic AI System',
            instructor: 'Aishwarya Naresh Reganti',
            difficulty: 'INTERMEDIATE',
            duration_sec: '3932',
            rating: '4.50',
            rating_count: 259,
            viewers: 25323,
            url: 'https://www.linkedin.com/learning/agentic-ai-build-your-first-agentic-ai-system',
        });
    });

    it('drops rows without slug identity', () => {
        const row = parseRow({ entityType: 'COURSE', headline: { title: { text: 't' } } }, 2);
        expect(row).toBeNull();
    });

});
