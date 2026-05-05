import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';

describe('weixin search command', () => {
    const command = getRegistry().get('weixin/search');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('weixin');
        expect(command.strategy).toBe('public');
        expect(command.browser).toBe(true);
    });

    it('rejects empty queries before browser navigation', async () => {
        const page = { goto: vi.fn() };

        await expect(command.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });

        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects invalid page and limit values before browser navigation', async () => {
        const page = { goto: vi.fn() };

        await expect(command.func(page, { query: 'AI', page: 0 })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        await expect(command.func(page, { query: 'AI', limit: 11 })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        await expect(command.func(page, { query: 'AI', limit: '2abc' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('uses page and limit while preserving per-page ranking', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                blocked: false,
                empty: false,
                cardCount: 2,
                invalidCount: 0,
                rows: [
                    {
                        title: 'First article',
                        url: 'https://weixin.sogou.com/link?url=abc',
                        summary: 'First summary',
                        publish_time: '2小时前',
                    },
                    {
                        title: 'Second article',
                        url: 'https://weixin.sogou.com/link?url=def',
                        summary: 'Second summary',
                        publish_time: '1小时前',
                    },
                ],
            }),
        };

        const result = await command.func(page, { query: 'AI', page: 2, limit: 1 });

        expect(page.goto).toHaveBeenCalledWith('https://weixin.sogou.com/weixin?query=AI&type=2&page=2&ie=utf8');
        expect(result).toEqual([
            {
                rank: 11,
                page: 2,
                title: 'First article',
                url: 'https://weixin.sogou.com/link?url=abc',
                summary: 'First summary',
                publish_time: '2小时前',
            },
        ]);
    });

    it('preserves browser-side cleanup regex escapes', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                blocked: false,
                empty: false,
                cardCount: 1,
                invalidCount: 0,
                rows: [
                    {
                        title: 'Article',
                        url: 'https://weixin.sogou.com/link?url=abc',
                        summary: 'Summary',
                        publish_time: '2024-4-28',
                    },
                ],
            }),
        };

        await command.func(page, { query: 'AI' });

        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain(".replace(/\\s+/g, ' ')");
        expect(script).toContain(".replace(/document\\.write\\(timeConvert\\('\\d+'\\)\\)/g, '')");
    });

    it('maps browser navigation failures to CommandExecutionError', async () => {
        const page = {
            goto: vi.fn().mockRejectedValue(new Error('net::ERR_FAILED')),
        };

        await expect(command.func(page, { query: 'AI' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
        });
    });

    it('fails fast on unreadable payloads, verification blocks, and partial card extraction', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(),
        };

        page.evaluate.mockResolvedValueOnce(null);
        await expect(command.func(page, { query: 'AI' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
        });

        page.evaluate.mockResolvedValueOnce({ blocked: true, empty: false, cardCount: 0, invalidCount: 0, rows: [] });
        await expect(command.func(page, { query: 'AI' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
        });

        page.evaluate.mockResolvedValueOnce({ blocked: false, empty: false, cardCount: 2, invalidCount: 1, rows: [{ title: 'Article', url: 'https://example.com' }] });
        await expect(command.func(page, { query: 'AI' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
        });
    });

    it('distinguishes explicit empty result pages from selector drift', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ blocked: false, empty: true, cardCount: 0, invalidCount: 0, rows: [] })
                .mockResolvedValueOnce({ blocked: false, empty: false, cardCount: 0, invalidCount: 0, rows: [] }),
        };

        await expect(command.func(page, { query: 'no-result' })).rejects.toMatchObject({
            name: 'EmptyResultError',
            code: 'EMPTY_RESULT',
        });
        await expect(command.func(page, { query: 'AI' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
        });
    });

    it('extracts browser DOM payload without silently dropping malformed result cards', async () => {
        const document = {
            body: { innerText: 'Article title Summary' },
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn((selector) => {
                if (selector !== '.news-list li')
                    return [];
                return [
                    {
                        querySelector: vi.fn((cardSelector) => {
                            if (cardSelector === 'h3 a[href]') {
                                return {
                                    textContent: 'Article title',
                                    getAttribute: vi.fn(() => '/link?url=abc'),
                                };
                            }
                            if (cardSelector === 'p.txt-info')
                                return { textContent: 'Summary' };
                            if (cardSelector === '.s-p .s2')
                                return { textContent: '2小时前' };
                            return null;
                        }),
                    },
                    {
                        querySelector: vi.fn(() => null),
                    },
                ];
            }),
        };
        const window = {
            location: { origin: 'https://weixin.sogou.com' },
            URL,
        };
        const script = __test__.buildExtractSearchResultsEvaluate();
        const payload = Function('document', 'window', 'URL', `return ${script};`)(document, window, URL);

        expect(payload).toMatchObject({
            blocked: false,
            empty: false,
            cardCount: 2,
            invalidCount: 1,
            rows: [
                {
                    title: 'Article title',
                    url: 'https://weixin.sogou.com/link?url=abc',
                    summary: 'Summary',
                    publish_time: '2小时前',
                },
            ],
        });
    });

    it('exposes pure normalizers for direct regression coverage', () => {
        expect(__test__.normalizePage(undefined)).toBe(1);
        expect(__test__.normalizeLimit(undefined)).toBe(10);
        expect(__test__.normalizeLimit(10)).toBe(10);
        expect(() => __test__.normalizeLimit(11)).toThrow(/out of range/);
        expect(__test__.buildSearchUrl('AI tools', 2)).toBe('https://weixin.sogou.com/weixin?query=AI+tools&type=2&page=2&ie=utf8');
    });
});
