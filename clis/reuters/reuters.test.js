import { describe, expect, it } from 'vitest';

import { buildArticleDetailScript, buildSearchScript, isAuthStatus, looksAuthWallText, mapArticleDetail, mapSearchArticles, parseLimit } from './utils.js';

describe('reuters parseLimit', () => {
    it('returns fallback for undefined / empty', () => {
        expect(parseLimit(undefined)).toBe(10);
        expect(parseLimit('')).toBe(10);
    });
    it('accepts integers in [1, 40]', () => {
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(40)).toBe(40);
        expect(parseLimit('25')).toBe(25);
    });
    it('rejects non-integer', () => {
        expect(() => parseLimit('abc')).toThrow('--limit must be an integer');
        expect(() => parseLimit(3.5)).toThrow('--limit must be an integer');
    });
    it('rejects out-of-range without silent clamp', () => {
        expect(() => parseLimit(0)).toThrow('--limit must be between 1 and 40, got 0');
        expect(() => parseLimit(41)).toThrow('--limit must be between 1 and 40, got 41');
    });
});

describe('reuters buildSearchScript', () => {
    it('embeds the user query as JSON-safe literal', () => {
        const script = buildSearchScript('hello "world"', 5);
        expect(script).toContain('"hello \\"world\\""');
        expect(script).toContain('size: 5');
    });
});

describe('reuters auth-wall helpers', () => {
    it('detects auth statuses and Reuters challenge/paywall text', () => {
        expect(isAuthStatus(401)).toBe(true);
        expect(isAuthStatus(403)).toBe(true);
        expect(isAuthStatus(500)).toBe(false);
        expect(looksAuthWallText('DataDome verify you are human')).toBe(true);
        expect(looksAuthWallText('Subscribe to continue reading')).toBe(true);
        expect(looksAuthWallText('ordinary article body')).toBe(false);
    });
});

describe('reuters mapSearchArticles', () => {
    const sampleBody = {
        result: {
            articles: [
                {
                    title: 'Tariff war heats up',
                    display_date: '2026-05-06T14:30:00.000Z',
                    taxonomy: { section: { name: 'World', path: '/world' } },
                    authors: [{ name: 'Jane Doe' }, { name: 'Bob Smith' }],
                    canonical_url: '/world/tariff-war-2026-05-06/',
                },
                {
                    headlines: { basic: 'Markets rally' },
                    published_time: '2026-05-05T09:00:00.000Z',
                    canonical_url: '/markets/rally-2026-05-05/',
                },
            ],
        },
    };

    it('projects to declared shape', () => {
        const rows = mapSearchArticles(sampleBody, 5);
        expect(rows).toEqual([
            {
                rank: 1,
                title: 'Tariff war heats up',
                date: '2026-05-06',
                section: 'World',
                section_path: '/world',
                authors: 'Jane Doe, Bob Smith',
                url: 'https://www.reuters.com/world/tariff-war-2026-05-06/',
            },
            {
                rank: 2,
                title: 'Markets rally',
                date: '2026-05-05',
                section: null,
                section_path: null,
                authors: null,
                url: 'https://www.reuters.com/markets/rally-2026-05-05/',
            },
        ]);
    });

    it('honors limit slice', () => {
        const rows = mapSearchArticles(sampleBody, 1);
        expect(rows).toHaveLength(1);
    });

    it('falls back to top-level articles array', () => {
        const rows = mapSearchArticles({ articles: [{ title: 'X', canonical_url: '/x/' }] }, 5);
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toBe('https://www.reuters.com/x/');
    });

    it('returns empty array when no articles', () => {
        expect(mapSearchArticles({}, 5)).toEqual([]);
    });

    it('drops rows that have no title (no silent empty-title row)', () => {
        const rows = mapSearchArticles({ articles: [{ canonical_url: '/x/' }] }, 5);
        expect(rows).toEqual([]);
    });

    it('drops rows without url because search.url is the article-detail id', () => {
        const rows = mapSearchArticles({ articles: [{ title: 'No URL' }, { title: 'Has URL', canonical_url: '/world/has-url/' }] }, 5);
        expect(rows).toEqual([
            {
                rank: 2,
                title: 'Has URL',
                date: null,
                section: null,
                section_path: null,
                authors: null,
                url: 'https://www.reuters.com/world/has-url/',
            },
        ]);
    });
});

describe('reuters mapArticleDetail', () => {
    it('projects fusion globalContent + body text', () => {
        const detail = mapArticleDetail(
            {
                title: 'Headline',
                display_date: '2026-05-06T14:30:00.000Z',
                taxonomy: { section: { name: 'Tech', path: '/tech' } },
                authors: [{ name: 'Alice' }],
                description: { basic: 'A summary.' },
                word_count: 312,
                canonical_url: '/tech/headline-2026-05-06/',
            },
            'Para 1\n\nPara 2',
        );
        expect(detail).toEqual({
            title: 'Headline',
            date: '2026-05-06',
            section: 'Tech',
            section_path: '/tech',
            authors: 'Alice',
            description: 'A summary.',
            word_count: 312,
            url: 'https://www.reuters.com/tech/headline-2026-05-06/',
            body: 'Para 1\n\nPara 2',
        });
    });

    it('returns null when neither article nor body text', () => {
        expect(mapArticleDetail(null, '')).toBeNull();
    });

    it('uses input URL fallback when fusion metadata has no canonical URL', () => {
        const detail = mapArticleDetail({ title: 'Body-only' }, 'Body text', 'https://www.reuters.com/world/body-only/');
        expect(detail.url).toBe('https://www.reuters.com/world/body-only/');
    });
});

describe('reuters buildArticleDetailScript', () => {
    it('returns a valid JS string referencing fusion-metadata + paragraph selectors', () => {
        const s = buildArticleDetailScript();
        expect(s).toContain('fusion-metadata');
        expect(s).toContain("data-testid^=\"paragraph-\"");
    });
});
