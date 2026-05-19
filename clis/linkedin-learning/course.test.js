import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './course.js';

const { parseSlug, parseCourse } = await import('./course.js').then((m) => m.__test__);

function makePage({ evaluateResult, cookies = [{ name: 'JSESSIONID', value: '"ajax:abc"' }] } = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookies),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('linkedin-learning course', () => {
    it('accepts a bare slug', () => {
        expect(parseSlug('agentic-ai-build')).toBe('agentic-ai-build');
    });

    it('extracts a slug from a full /learning/<slug> URL', () => {
        expect(parseSlug('https://www.linkedin.com/learning/agentic-ai-build/?foo=1'))
            .toBe('agentic-ai-build');
    });

    it('rejects empty or invalid slugs with ArgumentError', () => {
        expect(() => parseSlug('')).toThrow(ArgumentError);
        expect(() => parseSlug('   ')).toThrow(ArgumentError);
        expect(() => parseSlug('not a slug!')).toThrow(ArgumentError);
    });

    it('maps a course detail element to the canonical row shape', () => {
        const el = {
            title: 'Agentic AI: Build Your First Agentic AI System',
            description: { text: 'Dive into agentic AI...' },
            duration: { duration: 3932, unit: 'SECOND' },
            difficultyLevel: 'Intermediate',
            videosCount: 18,
            rating: { averageRating: 4.5, ratingCount: 259 },
            activatedAt: 1774569600000,
        };
        const row = parseCourse(el, 'agentic-ai-build-your-first-agentic-ai-system');
        expect(row.title).toBe('Agentic AI: Build Your First Agentic AI System');
        expect(row.slug).toBe('agentic-ai-build-your-first-agentic-ai-system');
        expect(row.description).toBe('Dive into agentic AI...');
        expect(row.difficulty).toBe('Intermediate');
        expect(row.duration_sec).toBe('3932');
        expect(row.videos_count).toBe(18);
        expect(row.rating).toBe('4.50');
        expect(row.rating_count).toBe(259);
        expect(row.released).toBe('2026-03-27');
        expect(row.url).toBe('https://www.linkedin.com/learning/agentic-ai-build-your-first-agentic-ai-system');
    });

    it('handles description as a bare string', () => {
        const row = parseCourse({ title: 't', description: 'plain string' }, 'x');
        expect(row.description).toBe('plain string');
    });

    it('returns empty fields when upstream omits them', () => {
        const row = parseCourse({}, 'x');
        expect(row.title).toBe('');
        expect(row.duration_sec).toBe('');
        expect(row.rating).toBe('');
        expect(row.released).toBe('');
    });

    it('throws AuthRequiredError when JSESSIONID is missing', async () => {
        const cmd = getRegistry().get('linkedin-learning/course');
        const page = makePage({ cookies: [], evaluateResult: { json: { elements: [{}] } } });
        await expect(cmd.func(page, { slug: 'agentic-ai-build' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws EmptyResultError when no element matches the slug', async () => {
        const cmd = getRegistry().get('linkedin-learning/course');
        const page = makePage({ evaluateResult: { json: { elements: [] } } });
        await expect(cmd.func(page, { slug: 'agentic-ai-build' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError on fetch errors', async () => {
        const cmd = getRegistry().get('linkedin-learning/course');
        const page = makePage({ evaluateResult: { error: 'HTTP 500' } });
        await expect(cmd.func(page, { slug: 'agentic-ai-build' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
