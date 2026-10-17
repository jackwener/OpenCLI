import { describe, expect, it, vi } from 'vitest';

import { __test__ } from './search.js';

describe('weixin search command', () => {
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
