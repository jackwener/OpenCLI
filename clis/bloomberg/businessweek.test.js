import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './businessweek.js';

const {
    command,
    extractBusinessweekStoriesFromNextData,
    normalizeBusinessweekStoryPath,
    parseBusinessweekLimit,
} = __test__;

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

});
