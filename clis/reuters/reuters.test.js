import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './article-detail.js';
import { buildArticleDetailScript, buildSearchScript, isAuthStatus, looksAuthWallText, mapArticleDetail, mapSearchArticles, parseLimit } from './utils.js';

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

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

describe('reuters search command (registry-level)', () => {
    const cmd = getRegistry().get('reuters/search');

    it('declares Strategy.COOKIE + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(String(cmd.strategy)).toContain('cookie');
    });

    it('rejects --limit out-of-range before browser navigation', async () => {
        const page = makePage(null);
        await expect(cmd.func(page, { query: 'x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { query: 'x', limit: 41 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects empty query as ArgumentError', async () => {
        const page = makePage(null);
        await expect(cmd.func(page, { query: '   ', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('throws CommandExecutionError when in-page fetch errored', async () => {
        const page = makePage({ ok: false, status: 0, body: null, error: 'NetworkError' });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws AuthRequiredError on Reuters auth/challenge status', async () => {
        const page = makePage({ ok: false, status: 403, body: { html: '<captcha/>' } });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError on non-auth upstream failure', async () => {
        const page = makePage({ ok: false, status: 500, statusText: 'Server Error', body: { error: 'upstream' } });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws AuthRequiredError when 200 body is Reuters challenge HTML', async () => {
        const page = makePage({ ok: true, status: 200, body: null, textPreview: 'DataDome verify you are human', parseError: 'Unexpected token <' });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError when 200 but body is null (captcha HTML)', async () => {
        const page = makePage({ ok: true, status: 200, body: null });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when API returned no articles', async () => {
        const page = makePage({ ok: true, status: 200, body: { result: { articles: [] } } });
        await expect(cmd.func(page, { query: 'x', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns mapped rows on success', async () => {
        const page = makePage({
            ok: true,
            status: 200,
            body: {
                result: {
                    articles: [
                        { title: 'A', display_date: '2026-05-06T00:00:00Z', canonical_url: '/a/' },
                    ],
                },
            },
        });
        const rows = await cmd.func(page, { query: 'tariff', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('A');
    });
});

describe('reuters article-detail command (registry-level)', () => {
    const cmd = getRegistry().get('reuters/article-detail');

    it('rejects empty url', async () => {
        const page = makePage(null);
        await expect(cmd.func(page, { url: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects non-reuters URL', async () => {
        const page = makePage(null);
        await expect(cmd.func(page, { url: 'https://example.com/article' })).rejects.toThrow('must be on reuters.com');
    });

    it('throws CommandExecutionError when in-page returns nothing', async () => {
        const page = makePage(null);
        await expect(cmd.func(page, { url: 'https://www.reuters.com/world/x/' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when in-page errored', async () => {
        const page = makePage({ ok: false, error: 'boom' });
        await expect(cmd.func(page, { url: 'https://www.reuters.com/world/x/' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws AuthRequiredError when page reports a paywall/challenge', async () => {
        const page = makePage({ ok: true, authRequired: true, body: { article: null, bodyText: null } });
        await expect(cmd.func(page, { url: 'https://www.reuters.com/world/x/' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws EmptyResultError when page rendered no article body', async () => {
        const page = makePage({ ok: true, body: { article: null, bodyText: null } });
        await expect(cmd.func(page, { url: 'https://www.reuters.com/world/x/' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns single-row detail on success', async () => {
        const page = makePage({
            ok: true,
            body: {
                article: {
                    title: 'H',
                    display_date: '2026-05-06T00:00:00Z',
                    taxonomy: { section: { name: 'World', path: '/world' } },
                    canonical_url: '/world/h/',
                },
                bodyText: 'Body here',
            },
        });
        const rows = await cmd.func(page, { url: 'https://www.reuters.com/world/h/' });
        expect(rows).toHaveLength(1);
        expect(rows[0].body).toBe('Body here');
        expect(rows[0].url).toBe('https://www.reuters.com/world/h/');
    });
});

describe('reuters buildArticleDetailScript', () => {
    it('returns a valid JS string referencing fusion-metadata + paragraph selectors', () => {
        const s = buildArticleDetailScript();
        expect(s).toContain('fusion-metadata');
        expect(s).toContain("data-testid^=\"paragraph-\"");
    });
});
