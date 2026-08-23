import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { expectRejectsWithMessage, makePage } from './test-helpers.js';
import './trending.js';

const { parseCard } = await import('./trending.js').then((m) => m.__test__);

describe('linkedin-learning trending', () => {
    it('maps a carousel card to the canonical row shape', () => {
        const card = {
            entityType: 'COURSE',
            slug: 'storytelling-editing',
            difficultyLevel: 'BEGINNER_INTERMEDIATE',
            description: { text: 'Go beyond basic video editing.' },
            viewerCount: 12345,
            headline: { title: { text: 'The Art of Storytelling through Editing' } },
        };
        const group = { annotation: 'TOP_PICKS', title: { text: 'Top picks for you' } };
        expect(parseCard(card, group, 1)).toEqual({
            rank: 1,
            group: 'Top picks for you',
            type: 'COURSE',
            title: 'The Art of Storytelling through Editing',
            difficulty: 'BEGINNER_INTERMEDIATE',
            viewers: 12345,
            url: 'https://www.linkedin.com/learning/storytelling-editing',
        });
    });

    it('drops cards without slug identity', () => {
        expect(parseCard({ title: { text: 'No slug' } }, { title: { text: 'G' } }, 1)).toBeNull();
    });

    it('flattens carousels and dedups cards across them', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({
            evaluateResult: {
                json: {
                    elements: [{
                        carousels: [
                            {
                                title: { text: 'Top picks' },
                                cards: [
                                    { slug: 'a', headline: { title: { text: 'Course A' } } },
                                    { headline: { title: { text: 'No slug' } } },
                                    { slug: 'b', headline: { title: { text: 'Course B' } } },
                                ],
                            },
                            {
                                title: { text: 'Trending in your network' },
                                cards: [
                                    { slug: 'a', headline: { title: { text: 'Dup of A' } } },
                                    { slug: 'c', headline: { title: { text: 'Course C' } } },
                                ],
                            },
                        ],
                    }],
                },
            },
        });
        const rows = await cmd.func(page, { limit: 5 });
        expect(rows.map((r) => r.title)).toEqual(['Course A', 'Course B', 'Course C']);
        expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
        expect(rows[0].group).toBe('Top picks');
        expect(rows[2].group).toBe('Trending in your network');
    });

    it('respects --limit', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const cards = Array.from({ length: 6 }, (_, i) => ({ slug: `s${i}`, headline: { title: { text: `T${i}` } } }));
        const page = makePage({
            evaluateResult: {
                json: { elements: [{ carousels: [{ title: { text: 'G' }, cards }] }] },
            },
        });
        const rows = await cmd.func(page, { limit: 3 });
        expect(rows).toHaveLength(3);
    });

    it('rejects invalid --limit before navigation', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({ evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequiredError when JSESSIONID is missing', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({ cookies: [], evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('keeps the exact page-required message local to trending', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        await expectRejectsWithMessage(
            cmd.func(undefined, { limit: 5 }),
            CommandExecutionError,
            'Browser session required for linkedin-learning trending'
        );
    });

    it('keeps the exact feedRecommendationGroups failure message local to trending', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({ evaluateResult: { error: 'HTTP 500' } });
        await expectRejectsWithMessage(
            cmd.func(page, { limit: 5 }),
            CommandExecutionError,
            'LinkedIn Learning feedRecommendationGroups failed: HTTP 500'
        );
    });

    it('throws EmptyResultError when no carousels yield cards', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({ evaluateResult: { json: { elements: [{ carousels: [] }] } } });
        await expect(cmd.func(page, { limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when the elements array is missing', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({ evaluateResult: { json: { data: {} } } });
        await expectRejectsWithMessage(
            cmd.func(page, { limit: 5 }),
            CommandExecutionError,
            'LinkedIn Learning feedRecommendationGroups returned malformed payload: missing elements array'
        );
    });

    it('throws CommandExecutionError when cards lack slug identity', async () => {
        const cmd = getRegistry().get('linkedin-learning/trending');
        const page = makePage({
            evaluateResult: {
                json: { elements: [{ carousels: [{ title: { text: 'G' }, cards: [{ headline: { title: { text: 'No slug' } } }] }] }] },
            },
        });
        await expect(cmd.func(page, { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
