import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    PAPER_COLUMNS,
    SEARCH_COLUMNS,
    coerceInt,
    decodeXmlEntities,
    extractAll,
    extractFirst,
    extractOpenAccessLink,
    extractRecordKey,
    extractRecordType,
    normalizeAuthors,
    recordXmlToRow,
    requireBoundedInt,
    requireQuery,
    requireRecordKey,
    searchHitToRow,
} from './utils.js';
import './search.js';
import './paper.js';

const SEARCH_HIT = {
    '@score': '9',
    '@id': '2578896',
    info: {
        authors: {
            author: [
                { '@pid': '167/1261-9', text: 'Xiaopeng Zhang 0009' },
                { '@pid': '17/8386', text: 'Haoyu Yang' },
                { '@pid': 'y/EFYYoung', text: 'Evangeline F. Y. Young' },
            ],
        },
        title: 'Attentional Transfer is All You Need: Technology-aware Layout Pattern Generation.',
        venue: 'DAC',
        pages: '169-174',
        year: '2021',
        type: 'Conference and Workshop Papers',
        access: 'closed',
        key: 'conf/dac/ZhangYY21',
        doi: '10.1109/DAC18074.2021.9586227',
        ee: 'https://doi.org/10.1109/DAC18074.2021.9586227',
        url: 'https://dblp.org/rec/conf/dac/ZhangYY21',
    },
};

const RECORD_XML = `<?xml version="1.0" encoding="US-ASCII"?>
<dblp>
<inproceedings key="conf/nips/VaswaniSPUJGKP17" mdate="2021-01-21">
<author>Ashish Vaswani</author>
<author>Noam Shazeer</author>
<author>Niki Parmar</author>
<author>Jakob Uszkoreit</author>
<author>Llion Jones</author>
<author>Aidan N. Gomez</author>
<author>Lukasz Kaiser</author>
<author>Illia Polosukhin</author>
<title>Attention is All you Need.</title>
<pages>5998-6008</pages>
<year>2017</year>
<booktitle>NIPS</booktitle>
<ee type="oa">https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html</ee>
<ee type="oa">http://papers.nips.cc/paper/7181-attention-is-all-you-need</ee>
<crossref>conf/nips/2017</crossref>
<url>db/conf/nips/nips2017.html#VaswaniSPUJGKP17</url>
</inproceedings></dblp>`;

const ARTICLE_XML = `<dblp>
<article key="journals/corr/abs-2509-05821" publtype="informal" mdate="2025-10-21">
<author>Mohsen Asghari Ilani</author>
<author>Yaser Mohammadi Banadaki</author>
<title>Brain Tumor Detection Through Diverse CNN Architectures.</title>
<year>2025</year>
<volume>abs/2509.05821</volume>
<journal>CoRR</journal>
<ee type="oa">https://doi.org/10.48550/arXiv.2509.05821</ee>
</article></dblp>`;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('dblp adapter', () => {
    it('registers search and paper with the expected columns', () => {
        const search = getRegistry().get('dblp/search');
        const paper = getRegistry().get('dblp/paper');
        expect(search).toBeDefined();
        expect(paper).toBeDefined();
        expect(search.columns).toEqual(SEARCH_COLUMNS);
        expect(paper.columns).toEqual(PAPER_COLUMNS);
        expect(search.strategy).toBe('public');
        expect(paper.strategy).toBe('public');
        expect(search.browser).toBe(false);
        expect(paper.browser).toBe(false);
    });

    it('paper aliases include detail / view', () => {
        const paper = getRegistry().get('dblp/paper');
        expect(paper.aliases).toEqual(expect.arrayContaining(['detail', 'view']));
    });

    describe('coerceInt', () => {
        it.each([
            [42, 42],
            ['42', 42],
            [' 7 ', 7],
            [3.14, NaN],
            ['x', NaN],
            ['', NaN],
            [null, NaN],
        ])('coerceInt(%j) → %j', (input, expected) => {
            const got = coerceInt(input);
            if (Number.isNaN(expected)) expect(Number.isNaN(got)).toBe(true);
            else expect(got).toBe(expected);
        });
    });

    describe('requireBoundedInt', () => {
        it('uses the default when value is undefined', () => {
            expect(requireBoundedInt(undefined, 20, 100)).toBe(20);
        });
        it('rejects 0 / negative / float', () => {
            expect(() => requireBoundedInt(0, 20, 100)).toThrow(ArgumentError);
            expect(() => requireBoundedInt(-1, 20, 100)).toThrow(ArgumentError);
            expect(() => requireBoundedInt(1.5, 20, 100)).toThrow(ArgumentError);
        });
        it('rejects values above the cap', () => {
            expect(() => requireBoundedInt(101, 20, 100)).toThrow(/<= 100/);
        });
        it('accepts the boundary', () => {
            expect(requireBoundedInt(100, 20, 100)).toBe(100);
            expect(requireBoundedInt(1, 20, 100)).toBe(1);
        });
    });

    describe('requireQuery', () => {
        it('rejects empty / whitespace-only', () => {
            expect(() => requireQuery('')).toThrow(ArgumentError);
            expect(() => requireQuery('   ')).toThrow(ArgumentError);
            expect(() => requireQuery(undefined)).toThrow(ArgumentError);
        });
        it('trims surrounding whitespace', () => {
            expect(requireQuery('  bert  ')).toBe('bert');
        });
    });

    describe('requireRecordKey', () => {
        it('accepts known dblp keys', () => {
            expect(requireRecordKey('conf/nips/VaswaniSPUJGKP17')).toBe('conf/nips/VaswaniSPUJGKP17');
            expect(requireRecordKey('journals/corr/abs-2509-05821')).toBe('journals/corr/abs-2509-05821');
            expect(requireRecordKey('phd/Smith2020')).toBe('phd/Smith2020');
        });
        it('rejects bad shapes', () => {
            expect(() => requireRecordKey('')).toThrow(ArgumentError);
            expect(() => requireRecordKey('NoSlashes')).toThrow(ArgumentError);
            expect(() => requireRecordKey('conf//Empty')).toThrow(ArgumentError);
            expect(() => requireRecordKey('Conf/nips/x')).toThrow(ArgumentError);
            expect(() => requireRecordKey('https://dblp.org/rec/conf/x/y')).toThrow(ArgumentError);
        });
    });

    describe('decodeXmlEntities', () => {
        it('decodes common entities', () => {
            expect(decodeXmlEntities('a &amp; b')).toBe('a & b');
            expect(decodeXmlEntities('don&apos;t')).toBe("don't");
            expect(decodeXmlEntities('a &lt; b &gt; c')).toBe('a < b > c');
            expect(decodeXmlEntities('&quot;x&quot;')).toBe('"x"');
            expect(decodeXmlEntities('&#x4E2D;')).toBe('中');
            expect(decodeXmlEntities('&#65;')).toBe('A');
        });
        it('returns empty string for null/undefined', () => {
            expect(decodeXmlEntities(undefined)).toBe('');
            expect(decodeXmlEntities(null)).toBe('');
        });
    });

    describe('normalizeAuthors', () => {
        it('handles array of {@pid, text}', () => {
            const authors = normalizeAuthors({
                author: [
                    { '@pid': 'a/1', text: 'Alice' },
                    { '@pid': 'b/2', text: 'Bob' },
                ],
            });
            expect(authors).toEqual(['Alice', 'Bob']);
        });
        it('handles single-object form', () => {
            expect(normalizeAuthors({ author: { '@pid': 'a/1', text: 'Alice' } })).toEqual(['Alice']);
        });
        it('strips trailing 4+ digit homonym suffixes', () => {
            expect(normalizeAuthors({ author: { text: 'Xiaopeng Zhang 0009' } })).toEqual(['Xiaopeng Zhang']);
        });
        it('handles empty / missing', () => {
            expect(normalizeAuthors(null)).toEqual([]);
            expect(normalizeAuthors({})).toEqual([]);
            expect(normalizeAuthors({ author: [] })).toEqual([]);
        });
    });

    describe('searchHitToRow', () => {
        it('projects a complete hit', () => {
            const row = searchHitToRow(SEARCH_HIT, 1);
            expect(row).toEqual({
                rank: 1,
                key: 'conf/dac/ZhangYY21',
                title: 'Attentional Transfer is All You Need: Technology-aware Layout Pattern Generation',
                authors: 'Xiaopeng Zhang, Haoyu Yang, Evangeline F. Y. Young',
                venue: 'DAC',
                year: '2021',
                type: 'conf',
                doi: '10.1109/DAC18074.2021.9586227',
                url: 'https://doi.org/10.1109/DAC18074.2021.9586227',
            });
        });
        it('falls back to dblp url when ee is missing', () => {
            const hit = { info: { ...SEARCH_HIT.info, ee: undefined } };
            expect(searchHitToRow(hit, 1).url).toBe('https://dblp.org/rec/conf/dac/ZhangYY21');
        });
        it('decodes HTML entities in titles / venue', () => {
            const hit = { info: { ...SEARCH_HIT.info, title: 'Don&apos;t Panic.', venue: 'A &amp; B' } };
            const row = searchHitToRow(hit, 1);
            expect(row.title).toBe("Don't Panic");
            expect(row.venue).toBe('A & B');
        });
        it('compresses long type strings', () => {
            const hit = { info: { ...SEARCH_HIT.info, type: 'Journal Articles' } };
            expect(searchHitToRow(hit, 1).type).toBe('journal');
        });
    });

    describe('XML record extraction', () => {
        it('extractFirst / extractAll handle multi-line content', () => {
            expect(extractFirst(RECORD_XML, 'title')).toBe('Attention is All you Need.');
            expect(extractAll(RECORD_XML, 'author')).toEqual([
                'Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit',
                'Llion Jones', 'Aidan N. Gomez', 'Lukasz Kaiser', 'Illia Polosukhin',
            ]);
        });
        it('extractRecordKey reads the wrapper attr', () => {
            expect(extractRecordKey(RECORD_XML)).toBe('conf/nips/VaswaniSPUJGKP17');
            expect(extractRecordKey(ARTICLE_XML)).toBe('journals/corr/abs-2509-05821');
        });
        it('extractRecordType maps wrapper element to canonical tag', () => {
            expect(extractRecordType(RECORD_XML)).toBe('conf');
            expect(extractRecordType(ARTICLE_XML)).toBe('journal');
        });
        it('extractOpenAccessLink prefers type=oa', () => {
            expect(extractOpenAccessLink(RECORD_XML)).toBe('https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html');
        });
    });

    describe('recordXmlToRow', () => {
        it('builds a complete row for an inproceedings record', () => {
            const row = recordXmlToRow(RECORD_XML);
            expect(row.key).toBe('conf/nips/VaswaniSPUJGKP17');
            expect(row.type).toBe('conf');
            expect(row.title).toBe('Attention is All you Need');
            expect(row.authors).toBe('Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin');
            expect(row.venue).toBe('NIPS');
            expect(row.year).toBe('2017');
            expect(row.pages).toBe('5998-6008');
            expect(row.open_access_url).toContain('proceedings.neurips.cc');
            expect(row.dblp_url).toBe('https://dblp.org/rec/conf/nips/VaswaniSPUJGKP17.html');
        });
        it('reads `journal` for an article record', () => {
            const row = recordXmlToRow(ARTICLE_XML);
            expect(row.venue).toBe('CoRR');
            expect(row.type).toBe('journal');
            expect(row.doi).toBe('10.48550/arXiv.2509.05821');
        });
    });
});

describe('dblp search command', () => {
    it('rejects invalid query before any network call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: '   ', limit: 5 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls the JSON search endpoint and projects hits', async () => {
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
            JSON.stringify({
                result: {
                    status: { '@code': '200', text: 'OK' },
                    hits: { hit: [SEARCH_HIT] },
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )));
        vi.stubGlobal('fetch', fetchMock);

        const search = getRegistry().get('dblp/search');
        const rows = await search.func({ query: 'attention', limit: 5 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledUrl = fetchMock.mock.calls[0][0];
        expect(calledUrl).toContain('/search/publ/api?q=attention&format=json&h=5');
        expect(rows).toHaveLength(1);
        expect(rows[0].rank).toBe(1);
        expect(rows[0].key).toBe('conf/dac/ZhangYY21');
    });

    it('throws EmptyResultError when dblp returns no hits', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(
            JSON.stringify({
                result: {
                    status: { '@code': '200', text: 'OK' },
                    hits: {},
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ))));
        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: 'aljkasdf', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('rate-limit (429) surfaces as a typed CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 429 }))));
        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: 'bert', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('in-band API status envelope surfaces as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(
            JSON.stringify({
                result: {
                    status: { '@code': '500', text: 'Backend error' },
                    hits: {},
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ))));
        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: 'bert', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('missing in-band API status code surfaces as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(
            JSON.stringify({
                result: {
                    hits: {},
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ))));
        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: 'bert', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('malformed JSON surfaces as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(
            'not json',
            { status: 200, headers: { 'content-type': 'application/json' } },
        ))));
        const search = getRegistry().get('dblp/search');
        await expect(search.func({ query: 'bert', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });
});

describe('dblp paper command', () => {
    it('fetches XML and projects a single row', async () => {
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
            RECORD_XML,
            { status: 200, headers: { 'content-type': 'application/xml' } },
        )));
        vi.stubGlobal('fetch', fetchMock);

        const paper = getRegistry().get('dblp/paper');
        const rows = await paper.func({ key: 'conf/nips/VaswaniSPUJGKP17' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledUrl = fetchMock.mock.calls[0][0];
        expect(calledUrl).toContain('/rec/conf/nips/VaswaniSPUJGKP17.xml');
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Attention is All you Need');
        expect(rows[0].dblp_url).toContain('VaswaniSPUJGKP17.html');
    });

    it('404 surfaces as EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 404 }))));
        const paper = getRegistry().get('dblp/paper');
        await expect(paper.func({ key: 'conf/x/never' })).rejects.toThrow(EmptyResultError);
    });

    it('rejects malformed keys before any network call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const paper = getRegistry().get('dblp/paper');
        await expect(paper.func({ key: 'NotARealKey' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
