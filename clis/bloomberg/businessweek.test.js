import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CliError } from '@jackwener/opencli/errors';
import { __test__ } from './businessweek.js';

const {
    command,
    extractBusinessweekStoriesFromNextData,
    normalizeBusinessweekStoryPath,
    parseBusinessweekLimit,
} = __test__;

function makePage(evaluateResults) {
    const results = Array.isArray(evaluateResults) ? evaluateResults : [evaluateResults];
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
            .mockImplementation(() => Promise.resolve(results.shift())),
    };
}

function nextDataWithItems(items) {
    return {
        props: {
            pageProps: {
                initialState: {
                    modulesById: {
                        lede_story_large: { items },
                    },
                },
            },
        },
    };
}

describe('Bloomberg Businessweek section feed', () => {
    it('registers as a public browser read command with stable columns', () => {
        expect(command.site).toBe('bloomberg');
        expect(command.name).toBe('businessweek');
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.strategy).toBe('public');
        expect(command.domain).toBe('www.bloomberg.com');
        expect(command.columns).toEqual(['title', 'summary', 'link', 'mediaLinks']);
    });

    it('validates --limit instead of silently clamping invalid values', () => {
        expect(parseBusinessweekLimit(undefined)).toBe(1);
        expect(parseBusinessweekLimit('')).toBe(1);
        expect(parseBusinessweekLimit('20')).toBe(20);
        expect(() => parseBusinessweekLimit(0)).toThrow(ArgumentError);
        expect(() => parseBusinessweekLimit(21)).toThrow(ArgumentError);
        expect(() => parseBusinessweekLimit(1.5)).toThrow(ArgumentError);
        expect(() => parseBusinessweekLimit('abc')).toThrow(ArgumentError);
    });

    it('accepts Bloomberg news and feature story paths from the section page only', () => {
        expect(normalizeBusinessweekStoryPath('/news/features/2026-06-08/story?srnd=phx-businessweek'))
            .toBe('/news/features/2026-06-08/story?srnd=phx-businessweek');
        expect(normalizeBusinessweekStoryPath('/features/2026-ice-detention-center/?srnd=phx-businessweek'))
            .toBe('/features/2026-ice-detention-center/?srnd=phx-businessweek');
        expect(normalizeBusinessweekStoryPath('https://www.bloomberg.com/features/2026-story/'))
            .toBe('/features/2026-story/');
        expect(normalizeBusinessweekStoryPath('https://example.com/features/2026-story/')).toBe('');
        expect(normalizeBusinessweekStoryPath('/markets')).toBe('');
        expect(normalizeBusinessweekStoryPath('javascript:alert(1)')).toBe('');
    });

    it('extracts current section-page stories, including /features paths, and dedupes by canonical path', () => {
        const rows = extractBusinessweekStoriesFromNextData(nextDataWithItems([
            {
                headline: 'SpaceX IPO Demands Trust',
                summary: 'A feature summary',
                url: '/news/features/2026-06-08/spacex-ipo?srnd=phx-businessweek',
                image: { baseUrl: 'https://assets.bwbx.io/spacex.jpg' },
            },
            {
                headline: 'ICE Warehouse Jails',
                eyebrow: { text: 'Feature' },
                url: '/features/2026-dhs-pennsylvania-warehouse-ice-detention-center/?srnd=phx-businessweek',
                lede: { url: 'https://assets.bwbx.io/ice.jpg' },
            },
            {
                headline: 'Duplicate without query',
                url: '/features/2026-dhs-pennsylvania-warehouse-ice-detention-center/',
            },
            {
                headline: 'Non-story module link',
                url: '/markets',
            },
        ]));

        expect(rows).toEqual([
            {
                title: 'SpaceX IPO Demands Trust',
                summary: 'A feature summary',
                link: 'https://www.bloomberg.com/news/features/2026-06-08/spacex-ipo?srnd=phx-businessweek',
                mediaLinks: ['https://assets.bwbx.io/spacex.jpg'],
            },
            {
                title: 'ICE Warehouse Jails',
                summary: 'Feature',
                link: 'https://www.bloomberg.com/features/2026-dhs-pennsylvania-warehouse-ice-detention-center/?srnd=phx-businessweek',
                mediaLinks: ['https://assets.bwbx.io/ice.jpg'],
            },
        ]);
    });

    it('returns rows from the browser section payload and respects validated limit', async () => {
        const page = makePage({
            ok: true,
            stories: [
                { title: 'One', summary: 'A', link: 'https://www.bloomberg.com/news/a', mediaLinks: [] },
                { title: 'Two', summary: 'B', link: 'https://www.bloomberg.com/features/b', mediaLinks: [] },
            ],
        });

        await expect(command.func(page, { limit: 1 })).resolves.toEqual([
            { title: 'One', summary: 'A', link: 'https://www.bloomberg.com/news/a', mediaLinks: [] },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.bloomberg.com/businessweek');
        expect(page.wait).toHaveBeenCalledWith({ selector: '#__NEXT_DATA__', timeout: 8 });
    });

    it('retries slow hydration diagnostics before failing', async () => {
        const page = makePage([
            { ok: false, error: 'NO_NEXT_DATA', title: 'Businessweek' },
            {
                ok: true,
                stories: [
                    { title: 'Hydrated', summary: '', link: 'https://www.bloomberg.com/news/hydrated', mediaLinks: [] },
                ],
            },
        ]);

        await expect(command.func(page, { limit: 5 })).resolves.toEqual([
            { title: 'Hydrated', summary: '', link: 'https://www.bloomberg.com/news/hydrated', mediaLinks: [] },
        ]);
        expect(page.wait).toHaveBeenCalledWith(4);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('fails typed for malformed section payloads', async () => {
        const page = makePage({ ok: false, error: 'NO_MODULES' });

        await expect(command.func(page, { limit: 5 })).rejects.toBeInstanceOf(CliError);
        await expect(command.func(makePage({ ok: true, stories: [] }), { limit: 5 })).rejects.toBeInstanceOf(CliError);
    });
});
