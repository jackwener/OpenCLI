import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { expectRejectsWithMessage, makePage } from './test-helpers.js';
import './search.js';

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

    it('throws AuthRequiredError when JSESSIONID cookie is missing', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ cookies: [], evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { keywords: 'x', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws AuthRequiredError when the fetch returns 403', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { authRequired: true, status: 403 } });
        await expect(cmd.func(page, { keywords: 'x', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('keeps the exact page-required message local to search', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        await expectRejectsWithMessage(
            cmd.func(undefined, { keywords: 'x', limit: 5 }),
            CommandExecutionError,
            'Browser session required for linkedin-learning search'
        );
    });

    it('throws CommandExecutionError when the upstream payload is empty', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { error: 'fetch failed: socket' } });
        await expectRejectsWithMessage(
            cmd.func(page, { keywords: 'x', limit: 5 }),
            CommandExecutionError,
            'LinkedIn Learning searchV2 failed: fetch failed: socket'
        );
    });

    it('throws EmptyResultError when zero elements come back', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { keywords: 'x', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when the elements array is missing', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { json: { data: {} } } });
        await expectRejectsWithMessage(
            cmd.func(page, { keywords: 'x', limit: 5 }),
            CommandExecutionError,
            'LinkedIn Learning searchV2 returned malformed payload: missing elements array'
        );
    });

    it('throws CommandExecutionError when elements lack slug identity', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { json: { elements: [{ headline: { title: { text: 'No slug' } } }] } } });
        await expect(cmd.func(page, { keywords: 'x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects empty keywords with ArgumentError before navigation', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { keywords: '   ', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects invalid --limit before navigation', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const page = makePage({ evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { keywords: 'x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('returns ranked rows when the API responds normally', async () => {
        const cmd = getRegistry().get('linkedin-learning/search');
        const elements = [
            { entityType: 'COURSE', slug: 'a', headline: { title: { text: 'Course A' } }, authors: [{ firstName: 'Inst', lastName: 'A' }], difficultyLevel: 'BEGINNER', length: { 'com.linkedin.common.TimeSpan': { duration: 100, unit: 'SECOND' } } },
            { entityType: 'COURSE', headline: { title: { text: 'No slug' } } },
            { entityType: 'VIDEO', slug: 'b', headline: { title: { text: 'Video B' } } },
        ];
        const page = makePage({ evaluateResult: { json: { elements } } });
        const rows = await cmd.func(page, { keywords: 'test', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0].rank).toBe(1);
        expect(rows[0].title).toBe('Course A');
        expect(rows[1].title).toBe('Video B');
        expect(rows[1].url).toBe('https://www.linkedin.com/learning/b');
    });
});
