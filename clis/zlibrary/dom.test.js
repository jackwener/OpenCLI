import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageMock } from '../test-utils.js';
import vm from 'node:vm';
import fs from 'node:fs';

function readFixtureJson(name) {
    return JSON.parse(
        fs.readFileSync(new URL(`../../tests/fixtures/zlibrary-app/${name}/evaluate-output.json`, import.meta.url), 'utf-8'),
    );
}

describe('zlibrary dom functions', () => {
    const DOM = {};
    let mod;

    beforeAll(async () => {
        mod = await import('./dom.js');
        Object.assign(DOM, mod);
    });

    describe('fmtBytes', () => {
        it('formats 0 bytes', () => {
            expect(DOM.fmtBytes(0)).toBe('0.0 B');
        });

        it('formats bytes to KB', () => {
            expect(DOM.fmtBytes(1024)).toBe('1.0 KB');
        });

        it('formats bytes to MB', () => {
            expect(DOM.fmtBytes(1048576)).toBe('1.0 MB');
        });

        it('formats bytes to GB', () => {
            expect(DOM.fmtBytes(1073741824)).toBe('1.0 GB');
        });

        it('handles negative and non-finite bytes gracefully', () => {
            expect(DOM.fmtBytes(-1)).toBe('0.0 B');
            expect(DOM.fmtBytes(NaN)).toBe('0.0 B');
            expect(DOM.fmtBytes(Infinity)).toBe('0.0 B');
        });
    });

    describe('validateLanguage', () => {
        it('accepts known languages (including en now)', () => {
            expect(DOM.validateLanguage('ja')).toBe(true);
            expect(DOM.validateLanguage('zh')).toBe(true);
            
            expect(DOM.validateLanguage('en')).toBe(true);
            expect(DOM.validateLanguage('fr')).toBe(true);
        });

        it('rejects unknown languages', () => {
            expect(DOM.validateLanguage('')).toBe(false);
            expect(DOM.validateLanguage(null)).toBe(false);
        });
    });

    describe('validateExtension', () => {
        it('accepts known extensions (case-insensitive)', () => {
            expect(DOM.validateExtension('pdf')).toBe(true);
            expect(DOM.validateExtension('epub')).toBe(true);
            expect(DOM.validateExtension('azw3')).toBe(true);
            expect(DOM.validateExtension('mobi')).toBe(true);
        });

        it('rejects unknown extensions', () => {
            expect(DOM.validateExtension('exe')).toBe(false);
            expect(DOM.validateExtension('docx')).toBe(false);
            expect(DOM.validateExtension('')).toBe(false);
            expect(DOM.validateExtension(null)).toBe(false);
        });
    });

    describe('validateContentType', () => {
        it('accepts known content types (case-insensitive)', () => {
            expect(DOM.validateContentType('book')).toBe(true);
            expect(DOM.validateContentType('article')).toBe(true);
            expect(DOM.validateContentType('magazine')).toBe(true);
            expect(DOM.validateContentType('thesis')).toBe(true);
            expect(DOM.validateContentType('BOOK')).toBe(true);
        });

        it('rejects unknown content types', () => {
            expect(DOM.validateContentType('video')).toBe(false);
            expect(DOM.validateContentType('')).toBe(false);
            expect(DOM.validateContentType(null)).toBe(false);
        });
    });

    describe('extractSearchResults', () => {
        it('returns parsed results with all attribute-based fields', async () => {
            const page = createPageMock([
                JSON.stringify([
                    {
                        rank: 1, title: 'Book One', author: 'Author One', year: '2024',
                        language: 'English', extension: 'pdf', contentType: 'book',
                        size: '2.5 MB', url: 'https://frenchbooks.sk/book/1', id: '12345',
                    },
                ]),
            ]);
            const results = await DOM.extractSearchResults(page, 10);
            expect(results).toHaveLength(1);
            expect(results[0]).toMatchObject({
                rank: 1,
                title: 'Book One',
                year: '2024',
                contentType: 'book',
                language: 'English',
                extension: 'pdf',
                size: '2.5 MB',
                id: '12345',
            });
        });

        it('returns empty array on parse failure', async () => {
            const page = createPageMock(['invalid json{{{']);
            const results = await DOM.extractSearchResults(page, 10);
            expect(results).toEqual([]);
        });

        it('sanitizes limit to sensible range before interpolation', async () => {
            // Capture the evaluate script to verify limit sanitization
            const captured = [];
            const page = createPageMock([], {
                evaluate: vi.fn((script) => {
                    captured.push(script);
                    return '[]';
                }),
            });

            await DOM.extractSearchResults(page, undefined);
            expect(captured[0]).toMatch(/slice\(0,\s*\d+\)/);
            const match = captured[0].match(/slice\(0,\s*(\d+)\)/);
            const limitInScript = match ? Number(match[1]) : -1;
            expect(limitInScript).toBeGreaterThanOrEqual(1);
            expect(limitInScript).toBeLessThanOrEqual(100);

            captured.length = 0;
            await DOM.extractSearchResults(page, -5);
            const negativeMatch = captured[0].match(/slice\(0,\s*(\d+)\)/);
            expect(Number(negativeMatch?.[1])).toBeGreaterThanOrEqual(1);

            captured.length = 0;
            await DOM.extractSearchResults(page, 9999);
            const excessiveMatch = captured[0].match(/slice\(0,\s*(\d+)\)/);
            expect(Number(excessiveMatch?.[1])).toBeLessThanOrEqual(100);
        });
    });

    // -----------------------------------------------------------------------
    // Gold fixture tests for extractSearchResults
    // -----------------------------------------------------------------------

    /**
     * Build lightweight DOM stubs for fixture cards that provide the same
     * shape the evaluate script expects from real <z-bookcard> elements:
     *  - textContent   (tags stripped → whitespace text nodes preserved)
     *  - getAttribute  (from tag attributes)
     *  - parentElement.className  (from container-info.json)
     *  - shadowRoot.querySelector('a').href  (derived from card `href` attr + base URL)
     *
     * URL derivation avoids any circular dependency on evaluate-output.json:
     * the card's own `href` attribute value is used as the internal relative URL.
     */
    const FIXTURE_BASE_URL = 'https://frenchbooks.sk';

    /** Strip HTML tags and decode entities to approximate browser textContent. */
    function stubTextContent(html) {
        let text = html.replace(/<[^>]*>/g, '');
        // Decode common HTML entities that real textContent would decode
        text = text.replace(/&amp;/g, '&')
                   .replace(/&nbsp;/g, '\u00A0')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&quot;/g, '"')
                   .replace(/&#39;/g, "'")
                   .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
        return text;
    }

    /** Extract all attributes from the opening card tag. */
    function extractAttributes(html) {
        const map = {};
        const re = /\b(\w[\w-]*)="([^"]*)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            map[m[1]] = m[2];
        }
        return map;
    }

    /** Convert a fixture/DOM URL to the internal relative URL policy. */
    function toRelativeFixtureUrl(hrefAttr) {
        if (!hrefAttr) return '';
        try {
            const parsed = new URL(hrefAttr, FIXTURE_BASE_URL + '/s/test');
            if (parsed.origin !== FIXTURE_BASE_URL) return '';
            return parsed.pathname + parsed.search + parsed.hash;
        } catch {
            return hrefAttr.startsWith('/') ? hrefAttr : '';
        }
    }

    /**
     * Create a stubbed card object from fixture data.
     * URL is derived from the card's own `href` attribute, NOT from expected output.
     */
    function stubCard(cardHtml, containerInfoEntry) {
        const attrs = extractAttributes(cardHtml);
        const parentClassName = containerInfoEntry
            ? containerInfoEntry.parentClassName
            : 'book-item resItemBoxBooks ';
        const hrefAttr = attrs.href || '';
        const relativeUrl = toRelativeFixtureUrl(hrefAttr);

        // Browser anchor.href is absolute; production must normalize it back to
        // an internal relative URL before returning search rows.
        const absoluteUrl = relativeUrl ? FIXTURE_BASE_URL + relativeUrl : '';
        const shadowRootStub = absoluteUrl
            ? { querySelector(sel) { return sel === 'a' ? { href: absoluteUrl } : null; } }
            : null;
        return {
            textContent: stubTextContent(cardHtml),
            getAttribute(name) { return name in attrs ? attrs[name] : null; },
            parentElement: { className: parentClassName },
            shadowRoot: shadowRootStub,
        };
    }

    /**
     * Capture the evaluate script string that extractSearchResults generates
     * for a given limit.
     */
    async function captureScript(limit) {
        const capturePage = {
            evaluate: vi.fn().mockResolvedValue('[]'),
            wait: vi.fn(),
        };
        await DOM.extractSearchResults(capturePage, limit);
        return capturePage.evaluate.mock.calls[0][0];
    }

    /**
     * Run a previously captured evaluate script against an array of stubbed
     * card objects in a vm sandbox.
     */
    function runScriptOnStubs(script, stubbedCards) {
        const sandbox = vm.createContext({
            document: { querySelectorAll: () => stubbedCards },
            window: { location: { href: FIXTURE_BASE_URL + '/s/test', origin: FIXTURE_BASE_URL } },
            URL,
        });
        const jsonString = vm.runInContext(script, sandbox);
        return JSON.parse(jsonString);
    }

    /**
     * Load a gold fixture and run extractSearchResults against it.
     */
    async function runFixtureExtract(fixtureName, limit) {
        const base = new URL(
            `../../tests/fixtures/zlibrary-app/${fixtureName}/`,
            import.meta.url,
        );
        const cardsHtml = fs.readFileSync(new URL('cards.html', base), 'utf-8');
        const containerInfo = JSON.parse(
            fs.readFileSync(new URL('container-info.json', base), 'utf-8'),
        );

        // Extract card HTML fragments
        const cardEls =
            cardsHtml.match(/<z-bookcard[\s\S]*?<\/z-bookcard>/g) || [];

        // Build stubbed cards (URLs derived from card href attr, not from expected output)
        const stubbedCards = cardEls.map((html, i) =>
            stubCard(html, containerInfo[i]),
        );

        const script = await captureScript(limit);
        return runScriptOnStubs(script, stubbedCards);
    }

    describe('extractSearchResults (gold fixture tests)', () => {
        it('search-test fixture: parses all cards with correct fields', async () => {
            const results = await runFixtureExtract('search-test');
            const expected = readFixtureJson('search-test');

            expect(results).toHaveLength(expected.length);

            // Spot‑check first few results for every declared field
            for (let i = 0; i < Math.min(3, results.length); i++) {
                expect(results[i]).toMatchObject({
                    rank: expected[i].rank,
                    title: expected[i].title,
                    author: expected[i].author,
                    year: expected[i].year,
                    language: expected[i].language,
                    extension: expected[i].extension,
                    contentType: expected[i].contentType,
                    size: expected[i].size,
                    url: expected[i].url,
                    id: expected[i].id,
                });
            }
        });

        it('search-test fixture: respects limit parameter', async () => {
            const limited = await runFixtureExtract('search-test', 5);
            expect(limited).toHaveLength(5);
            expect(limited[0].rank).toBe(1);
            expect(limited[4].rank).toBe(5);
        });

        it('search-harry-potter fixture: parses correctly including year="" edge case', async () => {
            const results = await runFixtureExtract('search-harry-potter');
            const expected = readFixtureJson('search-harry-potter');

            expect(results.length).toBeGreaterThan(0);

            // Check first result fields
            expect(results[0]).toMatchObject({
                title: expected[0].title,
                author: expected[0].author,
                language: expected[0].language,
                extension: expected[0].extension,
                url: expected[0].url,
                id: expected[0].id,
            });

            // Edge case: card with year="" (empty attribute — falsy fallback)
            // id=28448834 in this fixture has year="" attribute → year should be ''
            const noYearCard = results.find((r) => r.id === '28448834');
            expect(noYearCard).toBeDefined();
            expect(noYearCard.year).toBe('');

            // Edge case: card with year="0" (falsy‑but‑truthy string)
            // id=18349833 has year="0" attribute → year should be '0'
            const yearZeroCard = results.find((r) => r.id === '18349833');
            expect(yearZeroCard).toBeDefined();
            expect(yearZeroCard.year).toBe('0');
        });

        it('search-harry-potter fixture: contains multiple languages', async () => {
            const results = await runFixtureExtract('search-harry-potter');
            const languages = [...new Set(results.map((r) => r.language))];
            expect(languages).toContain('English');
            expect(languages).toContain('Chinese');
            expect(languages).toContain('German');
            expect(languages).toContain('French');
        });

        it('search-empty fixture returns empty array', async () => {
            const results = await runFixtureExtract('search-empty');
            expect(results).toEqual([]);
        });

        it('gold fixture expected urls are absolute HTTP(S)', () => {
            const fixtureNames = [
                'search-test', 'search-test-p2', 'search-harry-potter',
                'search-ml', 'search-programming', 'search-japanese', 'search-articles',
            ];
            for (const name of fixtureNames) {
                const data = readFixtureJson(name);
                for (const row of data) {
                    expect(row.url).toMatch(/^https?:\/\//);
                }
            }
        });

        it('gold fixture extracted urls are absolute HTTP(S)', async () => {
            const results = await runFixtureExtract('search-test');
            expect(results.length).toBeGreaterThan(0);
            for (const r of results) {
                expect(r.url).toMatch(/^https?:\/\//);
            }
        });

        // -------------------------------------------------------------------
        // Focused edge-case tests (inline stubs, no gold fixture dependency)
        // -------------------------------------------------------------------

        describe('extract script — focused edge cases', () => {
            let script;
            beforeAll(async () => {
                script = await captureScript(50);
            });

            it('year regex fallback: missing year attribute but textContent contains 2020', () => {
                // Card with NO year attribute but "2020" appears in slot note text
                const card = {
                    textContent: 'Some Book\n                     Some Author\n                     2020\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'year-fallback-test',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: '/book/year-fallback',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/year-fallback' } : null; } },
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.year).toBe('2020');
                expect(result.url).toBe('https://frenchbooks.sk/book/year-fallback');
                expect(result.title).toBe('Some Book');
                expect(result.author).toBe('Some Author');
            });

            it('url fallback: no shadowRoot but card has href attribute', () => {
                // Card with NO shadowRoot stub but has an href attribute on the element
                const card = {
                    textContent: 'Fallback Book\n                     Fallback Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'url-fallback-test',
                            year: '2023',
                            language: 'English',
                            extension: 'epub',
                            filesize: '2 MB',
                            href: '/book/fallback-test-url',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: null, // no shadow DOM → production falls back to href attr
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.url).toBe('https://frenchbooks.sk/book/fallback-test-url');
                expect(result.title).toBe('Fallback Book');
                expect(result.id).toBe('url-fallback-test');
            });

            it('url normalization rejects cross-origin absolute DOM URLs', () => {
                const card = {
                    textContent: 'External Book\nExternal Author',
                    getAttribute(name) {
                        const attrs = {
                            id: 'external-url-test',
                            year: '2023',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: 'https://evil.example/book/external',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: null,
                };
                expect(runScriptOnStubs(script, [card])).toEqual([]);
            });

            it('extract script resolves relative card href to absolute URL', () => {
                const card = {
                    textContent: 'Relative Book\n                     Relative Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'relative-test',
                            year: '2022',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '3 MB',
                            href: '/book/relative-path',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: null,
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.url).toBe('https://frenchbooks.sk/book/relative-path');
                expect(result.title).toBe('Relative Book');
            });

            it('extract script returns qualityRating from rating attribute (non-zero)', () => {
                const card = {
                    textContent: 'Rating Book\n                     Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'rating-test',
                            year: '2023',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: '/book/rating-test',
                            rating: '5.0',
                            quality: '4.0',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/rating-test' } : null; } },
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.qualityRating).toBe('5.0');
                expect(result.formatQualityRating).toBe('4.0');
            });

            it('extract script returns NA qualityRating when rating is "0.0"', () => {
                const card = {
                    textContent: 'No Rating Book\n                     Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'no-rating-test',
                            year: '2023',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: '/book/no-rating-test',
                            rating: '0.0',
                            quality: '0.0',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/no-rating-test' } : null; } },
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.qualityRating).toBe('NA');
                expect(result.formatQualityRating).toBe('NA');
            });

            it('extract script returns NA qualityRating when rating attribute is missing', () => {
                const card = {
                    textContent: 'Missing Rating Book\n                     Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'missing-rating-test',
                            year: '2023',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: '/book/missing-rating-test',
                            // No rating or quality attribute
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/missing-rating-test' } : null; } },
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.qualityRating).toBe('NA');
                expect(result.formatQualityRating).toBe('NA');
            });

            it('extract script returns default false for favorite/booklist/downloaded', () => {
                const card = {
                    textContent: 'Default Flags Book\n                     Author\n                    ',
                    getAttribute(name) {
                        const attrs = {
                            id: 'flags-test',
                            year: '2023',
                            language: 'English',
                            extension: 'pdf',
                            filesize: '1 MB',
                            href: '/book/flags-test',
                            rating: '5.0',
                            quality: '4.0',
                        };
                        return name in attrs ? attrs[name] : null;
                    },
                    parentElement: { className: 'book-item resItemBoxBooks ' },
                    shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/flags-test' } : null; } },
                };
                const [result] = runScriptOnStubs(script, [card]);
                expect(result).toBeDefined();
                expect(result.favorite).toBe(false);
                expect(result.booklist).toBe(false);
                expect(result.downloaded).toBe(false);
            });

            describe('boolean flag selectors', () => {
                it('favorite from attribute [favorite="true"]', () => {
                    const card = {
                        textContent: 'Favorite Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'fav-attr-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/fav-attr',
                                favorite: 'true',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/fav-attr' } : null; } },
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.favorite).toBe(true);
                });

                it('favorite from shadow DOM .like.zlibicon-heart-fill', () => {
                    const card = {
                        textContent: 'Heart Fill Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'fav-shadow-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/fav-shadow',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: {
                            querySelector(sel) {
                                if (sel === 'a') return { href: 'https://frenchbooks.sk/book/fav-shadow' };
                                if (sel === '.actions .like.zlibicon-heart-fill') return {};
                                return null;
                            },
                        },
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.favorite).toBe(true);
                });

                it('booklist from attribute [booklisted="true"]', () => {
                    const card = {
                        textContent: 'Booklisted Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'bl-attr-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/bl-attr',
                                booklisted: 'true',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: { querySelector(sel) { return sel === 'a' ? { href: 'https://frenchbooks.sk/book/bl-attr' } : null; } },
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.booklist).toBe(true);
                });

                it('booklist from shadow DOM .bookmark.zlibicon-flag-fill', () => {
                    const card = {
                        textContent: 'Flag Fill Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'bl-shadow-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/bl-shadow',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: {
                            querySelector(sel) {
                                if (sel === 'a') return { href: 'https://frenchbooks.sk/book/bl-shadow' };
                                if (sel === '.actions .bookmark.zlibicon-flag-fill') return {};
                                return null;
                            },
                        },
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.booklist).toBe(true);
                });

                it('downloaded from nested shadow DOM <z-cover> .mark.downloaded', () => {
                    const card = {
                        textContent: 'Downloaded Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'dl-shadow-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/dl-shadow',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: {
                            querySelector(sel) {
                                if (sel === 'a') return { href: 'https://frenchbooks.sk/book/dl-shadow' };
                                if (sel === 'z-cover') return {
                                    shadowRoot: {
                                        querySelector(s) { return s === '.mark.downloaded' ? {} : null; },
                                    },
                                };
                                return null;
                            },
                        },
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.downloaded).toBe(true);
                });

                it('boolean flags default to false when no shadowRoot', () => {
                    const card = {
                        textContent: 'No Shadow Book\nAuthor\n',
                        getAttribute(name) {
                            const attrs = {
                                id: 'no-shadow-test', year: '2024', language: 'English',
                                extension: 'pdf', filesize: '1 MB', href: '/book/no-shadow',
                            };
                            return name in attrs ? attrs[name] : null;
                        },
                        parentElement: { className: 'book-item resItemBoxBooks ' },
                        shadowRoot: null,
                    };
                    const [result] = runScriptOnStubs(script, [card]);
                    expect(result).toBeDefined();
                    expect(result.favorite).toBe(false);
                    expect(result.booklist).toBe(false);
                    expect(result.downloaded).toBe(false);
                });
            });



            it('captured script contains valid \\d regex pattern (not broken 19d)', () => {
                // The production template literal uses \\d which should produce
                // \d (backslash + d) in the final evaluate script, not a bare "19d".
                // Check that the regex in the captured script uses proper digit escapes.
                const yearRegexPattern = script.match(/\/\^\(19(\\.)d\{2\}\|20\[0-2\]\2d\{\1\}\)\$\//);
                // Simpler: grep for the string 19\d in the captured script
                expect(script).toMatch(/19\\d/);
                // Also confirm it does NOT contain the broken form "19d" (bare d without backslash)
                // in a regex context. "19d{" would indicate the backslash was lost.
                expect(script).not.toMatch(/\/\^\(19d\{2\}/);
            });
        });

        describe('edge case — validation with invalid values', () => {
            it('validateExtension rejects unsupported extensions', () => {
                expect(DOM.validateExtension('exe')).toBe(false);
                expect(DOM.validateExtension('docx')).toBe(false);
                expect(DOM.validateExtension('')).toBe(false);
                expect(DOM.validateExtension(null)).toBe(false);
            });

            it('validateContentType rejects unsupported types', () => {
                expect(DOM.validateContentType('video')).toBe(false);
                expect(DOM.validateContentType('audio')).toBe(false);
                expect(DOM.validateContentType('')).toBe(false);
                expect(DOM.validateContentType(null)).toBe(false);
            });
        });
    });

    describe('extractFormats', () => {
        it('finds pdf/epub/azw3/mobi download links', async () => {
            const page = createPageMock([
                undefined,
                JSON.stringify({ pdf: '/dl/pdf', epub: '/dl/epub', azw3: '/dl/azw3', mobi: '/dl/mobi' }),
            ]);
            const formats = await DOM.extractFormats(page);
            expect(formats).toMatchObject({ pdf: '/dl/pdf', epub: '/dl/epub', azw3: '/dl/azw3', mobi: '/dl/mobi' });
        });

        it('returns empty strings for missing formats', async () => {
            const page = createPageMock([
                undefined,
                JSON.stringify({ pdf: '', epub: '', azw3: '', mobi: '' }),
            ]);
            const formats = await DOM.extractFormats(page);
            expect(formats).toEqual({ pdf: '', epub: '', azw3: '', mobi: '' });
        });

        it('handles null/array JSON from evaluate without crashing', async () => {
            const pageNull = createPageMock([
                undefined,
                'null',
            ]);
            const resultNull = await DOM.extractFormats(pageNull);
            expect(resultNull).toEqual({ pdf: '', epub: '', azw3: '', mobi: '' });

            const pageArray = createPageMock([
                undefined,
                '[]',
            ]);
            const resultArray = await DOM.extractFormats(pageArray);
            expect(resultArray).toEqual({ pdf: '', epub: '', azw3: '', mobi: '' });
        });
    });

    describe('extractBookTitle', () => {
        it('extracts title from page', async () => {
            const page = createPageMock(['Test Book Title']);
            const title = await DOM.extractBookTitle(page);
            expect(title).toBe('Test Book Title');
        });

        it('returns empty string for missing title', async () => {
            const page = createPageMock(['']);
            const title = await DOM.extractBookTitle(page);
            expect(title).toBe('');
        });
    });

    describe('extractBookLanguage', () => {
        it('accepts a known language name from evaluate', async () => {
            const page = createPageMock(['Japanese']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('Japanese');
        });

        it('rejects garbage category text (e.g. "Linguistics..." HTML dump)', async () => {
            const page = createPageMock(['Linguistics                                    \n                                \n\n                                                                    \n']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('');
        });

        it('rejects book-title-looking strings as language', async () => {
            const page = createPageMock(['官能小説「絶頂」表現用語用例辞典 (河出文庫)']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('');
        });

        it('returns empty string for empty evaluate result', async () => {
            const page = createPageMock(['']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('');
        });

        it('accepts Traditional Chinese as known language', async () => {
            const page = createPageMock(['Traditional Chinese']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('Traditional Chinese');
        });

        it('accepts case-insensitive match (lowercase input)', async () => {
            const page = createPageMock(['japanese']);
            const lang = await DOM.extractBookLanguage(page);
            expect(lang).toBe('japanese');
        });
    });

    describe('extractBookDetailAttributes', () => {
        it('extracts all fields from detail page metadata', async () => {
            const page = createPageMock([
                JSON.stringify({
                    pages: '350',
                    isbn10: '1234567890',
                    isbn13: '9781234567890',
                    series: 'The Great Series',
                    volume: 'Vol. 3',
                    categories: 'Fiction, Mystery',
                    description: 'A detailed description of the book that is long enough to pass the length check.',
                }),
            ]);
            const result = await DOM.extractBookDetailAttributes(page);
            expect(result.pages).toBe('350');
            expect(result.isbn10).toBe('1234567890');
            expect(result.isbn13).toBe('9781234567890');
            expect(result.series).toBe('The Great Series');
            expect(result.volume).toBe('Vol. 3');
            expect(result.categories).toBe('Fiction, Mystery');
            expect(result.description).toBe(
                'A detailed description of the book that is long enough to pass the length check.'
            );
        });

        it('returns empty strings when no metadata found', async () => {
            const page = createPageMock([
                JSON.stringify({
                    pages: '',
                    isbn10: '',
                    isbn13: '',
                    series: '',
                    volume: '',
                    categories: '',
                    description: '',
                    metaDescription: '',
                }),
            ]);
            const result = await DOM.extractBookDetailAttributes(page);
            expect(result).toEqual({
                publisher: '',
                isbn: '',
                pages: '',
                isbn10: '',
                isbn13: '',
                series: '',
                volume: '',
                categories: '',
                description: '',
                metaDescription: '',
                year: '',
                language: '',
                extension: '',
                filesize: '',
                rating: '',
                mainFormat: '',
                quality: '',
            });
        });

        it('returns empty strings when evaluate returns null', async () => {
            const page = createPageMock(['null']);
            const result = await DOM.extractBookDetailAttributes(page);
            expect(result).toEqual({
                publisher: '',
                isbn: '',
                pages: '',
                isbn10: '',
                isbn13: '',
                series: '',
                volume: '',
                categories: '',
                description: '',
                metaDescription: '',
                year: '',
                language: '',
                extension: '',
                filesize: '',
                rating: '',
                mainFormat: '',
                quality: '',
            });
        });

        it('returns empty strings for partial data', async () => {
            const page = createPageMock([
                JSON.stringify({
                    pages: '200',
                    isbn10: '',
                    isbn13: '',
                    series: '',
                    volume: '',
                    categories: '',
                    description: 'Only a description is available.',
                    metaDescription: '',
                }),
            ]);
            const result = await DOM.extractBookDetailAttributes(page);
            expect(result.pages).toBe('200');
            expect(result.description).toBe('Only a description is available.');
            expect(result.isbn10).toBe('');
            expect(result.series).toBe('');
            expect(result.categories).toBe('');
        });

        it('handles malformed JSON gracefully', async () => {
            const page = createPageMock(['not valid json{{{']);
            const result = await DOM.extractBookDetailAttributes(page);
            expect(result).toEqual({
                publisher: '',
                isbn: '',
                pages: '',
                isbn10: '',
                isbn13: '',
                series: '',
                volume: '',
                categories: '',
                description: '',
                metaDescription: '',
                year: '',
                language: '',
                extension: '',
                filesize: '',
                rating: '',
                mainFormat: '',
                quality: '',
            });
        });
    });

    // -------------------------------------------------------------------
    // VM-based tests for extractBookDetailAttributes evaluate script
    // -------------------------------------------------------------------

    /**
     * Capture the evaluate script that extractBookDetailAttributes generates
     * (wrapped in JSON.stringify + IIFE by evaluateJson).
     */
    async function captureDetailScript() {
        const capturePage = {
            evaluate: vi.fn().mockResolvedValue(JSON.stringify({
                publisher: '', isbn: '', pages: '', isbn10: '', isbn13: '',
                series: '', volume: '', categories: '', description: ''
            })),
            wait: vi.fn(),
        };
        await DOM.extractBookDetailAttributes(capturePage);
        return capturePage.evaluate.mock.calls[0][0];
    }

    /**
     * Run a previously captured extractBookDetailAttributes evaluate script
     * against stubbed DOM elements in a vm sandbox.
     *
     * @param {string} script - Full evaluate script (JSON.stringify wrapper + IIFE)
     * @param {{ card?: object, labelEls?: object[], categoryLinks?: object[], descEl?: object, mainEl?: object }} stubs
     * @returns {object} Parsed result
     */
    function runDetailScriptOnStubs(script, stubs) {
        const { card = null, labelEls = [], categoryLinks = [], descEl = null, mainEl = null } = stubs;

        const isDescSelector = (s) =>
            s === '.book-description' || s === '.book-desc' ||
            s === '.description-text' || s === '[itemprop="description"]' ||
            s === '.detail-description' || s === '#book-description';

        const isMainSelector = (s) =>
            s === 'main' || s === '[role="main"]' || s === 'article' ||
            s === '.content' || s === '.book-content' || s === '#content';

        const querySelector = (sel) => {
            // Handle compound selectors (comma-separated, e.g. 'main, [role="main"], article')
            // by trying each part and returning the first match.
            const parts = sel.split(',').map(s => s.trim());
            for (const s of parts) {
                if (isDescSelector(s) && descEl) return descEl;
                if (isMainSelector(s) && mainEl) return mainEl;
            }
            if (sel === 'z-bookcard') return card;
            return null;
        };

        const querySelectorAll = (sel) => {
            if (sel === 'div, span, th, dt, li, p, td') return labelEls;
            if (sel === 'a[href*="/category/"],a[href*="/categories/"],a[href*="/subject/"],a[href*="/booksubject/"]') return categoryLinks;
            return [];
        };

        const sandbox = vm.createContext({
            document: { querySelector, querySelectorAll },
            window: { location: { href: 'https://z-lib.sk/book/123', origin: 'https://z-lib.sk' } },
            URL,
        });
        const jsonString = vm.runInContext(script, sandbox);
        return JSON.parse(jsonString);
    }

    describe('extractBookDetailAttributes (VM script tests)', () => {
        let script;
        beforeAll(async () => {
            script = await captureDetailScript();
        });

        it('sibling label/value pairs: <span>Pages</span><span>350</span> → pages="350"', () => {
            // Simulate: <div><span>Pages</span><span>350</span></div>
            const valueSpan = { textContent: '350' };
            const pagesLabel = {
                textContent: 'Pages',
                nextElementSibling: valueSpan,
                parentElement: { nextElementSibling: null },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [pagesLabel, valueSpan],
            });
            expect(result.pages).toBe('350');
        });

        it('inline text: <li>ISBN-10: 1234567890</li> → isbn10="1234567890"', () => {
            // Simulate: <li>ISBN-10: 1234567890</li> — label + value in same element
            const li = {
                textContent: 'ISBN-10: 1234567890',
                nextElementSibling: null,
                parentElement: { nextElementSibling: null },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [li],
            });
            expect(result.isbn10).toBe('1234567890');
        });

        it('inline text: <li>ISBN-13: 9781234567890</li> → isbn13="9781234567890"', () => {
            const li = {
                textContent: 'ISBN-13: 9781234567890',
                nextElementSibling: null,
                parentElement: { nextElementSibling: null },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [li],
            });
            expect(result.isbn13).toBe('9781234567890');
        });

        it('sibling pair for series: <dt>Series</dt><dd>Foundation</dd>', () => {
            const valueDd = { textContent: 'Foundation' };
            const seriesDt = {
                textContent: 'Series',
                nextElementSibling: valueDd,
                parentElement: { nextElementSibling: null },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [seriesDt, valueDd],
            });
            expect(result.series).toBe('Foundation');
        });

        it('categories from <a> links: <a href="/category/fiction">Fiction</a>', () => {
            const catLinks = [
                { textContent: 'Fiction' },
                { textContent: 'Sci-Fi' },
            ];
            const result = runDetailScriptOnStubs(script, {
                categoryLinks: catLinks,
            });
            expect(result.categories).toBe('Fiction, Sci-Fi');
        });

        it('description from selector: <div class="book-description">...', () => {
            const descElement = {
                textContent: 'A detailed description of the book that exceeds the minimum length threshold for the description extraction logic.',
            };
            const result = runDetailScriptOnStubs(script, {
                descEl: descElement,
            });
            expect(result.description).toBeTruthy();
            expect(result.description.length).toBeGreaterThan(20);
        });

        it('description fallback to longest <p> in main content', () => {
            const mainElement = {
                querySelectorAll(sel) {
                    if (sel === 'p') return [
                        { textContent: 'Short.' },
                        { textContent: 'This is a much longer paragraph that exceeds the thirty character threshold and should be selected as the longest paragraph in the main content area.' },
                    ];
                    return [];
                },
            };
            const result = runDetailScriptOnStubs(script, {
                mainEl: mainElement,
            });
            expect(result.description).toBeTruthy();
            expect(result.description.length).toBeGreaterThan(30);
            expect(result.description).toContain('longer paragraph');
        });

        it('all fields empty when no data on page', () => {
            // No label elements, no card, no categories, no description
            const result = runDetailScriptOnStubs(script, {});
            expect(result).toEqual({
                publisher: '',
                isbn: '',
                pages: '',
                isbn10: '',
                isbn13: '',
                series: '',
                volume: '',
                categories: '',
                description: '',
                metaDescription: '',
            });
        });

        it('publisher and isbn from z-bookcard attribute', () => {
            const cardWithAttrs = {
                getAttribute(name) {
                    const attrs = { publisher: 'Penguin Books', isbn: '978-0-14-103614-4' };
                    return name in attrs ? attrs[name] : null;
                },
            };
            const result = runDetailScriptOnStubs(script, {
                card: cardWithAttrs,
            });
            expect(result.publisher).toBe('Penguin Books');
            expect(result.isbn).toBe('978-0-14-103614-4');
        });

        it('volume extracted from sibling pair: <span>Volume</span><span>Vol. 2</span>', () => {
            const valueSpan = { textContent: 'Vol. 2' };
            const volumeLabel = {
                textContent: 'Volume',
                nextElementSibling: valueSpan,
                parentElement: { nextElementSibling: null },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [volumeLabel, valueSpan],
            });
            expect(result.volume).toBe('Vol. 2');
        });

        it('label with colon: <th>Pages:</th><td>450</td>', () => {
            const pagesLabel = {
                textContent: 'Pages:',
                nextElementSibling: null,
                parentElement: {
                    nextElementSibling: { textContent: '450' },
                },
            };
            const result = runDetailScriptOnStubs(script, {
                labelEls: [pagesLabel],
            });
            expect(result.pages).toBe('450');
        });
    });
});
