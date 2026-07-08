import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    LINK_COLUMNS,
    RELATED_COLUMNS,
    SEARCH_COLUMNS,
    buildEutilsUrl,
    buildSearchQuery,
    parseArticleXml,
    requireBoundedInt,
    requirePmid,
} from './utils.js';
import './search.js';
import './article.js';
import './author.js';
import './citations.js';
import './related.js';
import './clinical-trial.js';
import './review.js';
import './mesh.js';
import './journal.js';

const SUMMARY_RESULT = {
    result: {
        uids: ['123', '456'],
        123: {
            uid: '123',
            title: 'Cancer machine learning.',
            authors: [{ name: 'Alice A' }, { name: 'Bob B' }, { name: 'Carol C' }, { name: 'Dan D' }],
            fulljournalname: 'Journal of Tests',
            pubdate: '2024 Jan',
            pubtype: ['Journal Article', 'Review'],
            articleids: [{ idtype: 'doi', value: '10.1000/test' }],
        },
        456: {
            uid: '456',
            title: 'Second article.',
            authors: [{ name: 'Eve E' }],
            source: 'Test Source',
            pubdate: '2023',
            pubtype: ['Journal Article'],
            articleids: [],
        },
    },
};

const ARTICLE_XML = `<?xml version="1.0"?>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">123</PMID>
    <Article>
      <Journal>
        <Title>Journal of Tests</Title>
        <JournalIssue><PubDate><Year>2024</Year><Month>Jan</Month><Day>02</Day></PubDate></JournalIssue>
      </Journal>
      <ArticleTitle>Detailed PubMed article &amp; title.</ArticleTitle>
      <Abstract><AbstractText>Background text.</AbstractText><AbstractText>Conclusion text.</AbstractText></Abstract>
      <AuthorList>
        <Author><LastName>Alice</LastName><ForeName>Example</ForeName><AffiliationInfo><Affiliation>Department of Oncology, SYSU.</Affiliation></AffiliationInfo></Author>
        <Author><LastName>Bob</LastName><Initials>B</Initials><AffiliationInfo><Affiliation>State Key Laboratory of Oncology.</Affiliation></AffiliationInfo></Author>
      </AuthorList>
      <Language>eng</Language>
      <PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
    </Article>
    <MeshHeadingList><MeshHeading><DescriptorName>Neoplasms</DescriptorName></MeshHeading></MeshHeadingList>
    <KeywordList><Keyword>machine learning</Keyword></KeywordList>
    <GrantList>
      <Grant><GrantID>81972898</GrantID><Agency>National Natural Science Foundation of China</Agency></Grant>
      <Grant><GrantID>2024A1515010001</GrantID><Agency>Guangdong Basic and Applied Basic Research Foundation</Agency></Grant>
    </GrantList>
  </MedlineCitation>
  <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/detail</ArticleId><ArticleId IdType="pmc">PMC123</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle>`;

const LONG_ARTICLE_XML = `<?xml version="1.0"?>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">555</PMID>
    <Article>
      <Journal>
        <Title>Clinical Trials Journal</Title>
        <JournalIssue><PubDate><Year>2025</Year><Month>Feb</Month><Day>14</Day></PubDate></JournalIssue>
      </Journal>
      <ArticleTitle>Long abstract trial paper.</ArticleTitle>
      <Abstract><AbstractText>${'Trial outcome sentence. '.repeat(40)}</AbstractText></Abstract>
      <AuthorList>
        <Author><LastName>Chan</LastName><ForeName>Robin</ForeName></Author>
      </AuthorList>
      <Language>eng</Language>
      <PublicationTypeList><PublicationType>Clinical Trial</PublicationType></PublicationTypeList>
    </Article>
  </MedlineCitation>
  <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/trial</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle>`;

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

function xmlResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: vi.fn().mockRejectedValue(new Error('not json')),
        text: vi.fn().mockResolvedValue(body),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('pubmed adapter registration', () => {
    it('registers nine public read commands with expected listing columns', () => {
        const registry = getRegistry();
        for (const name of ['search', 'article', 'author', 'citations', 'related', 'clinical-trial', 'review', 'mesh', 'journal']) {
            const command = registry.get(`pubmed/${name}`);
            expect(command).toBeDefined();
            expect(command.strategy).toBe('public');
            expect(command.browser).toBe(false);
        }
        expect(registry.get('pubmed/search').columns).toEqual(SEARCH_COLUMNS);
        expect(registry.get('pubmed/clinical-trial').columns).toEqual(SEARCH_COLUMNS);
        expect(registry.get('pubmed/review').columns).toEqual(SEARCH_COLUMNS);
        expect(registry.get('pubmed/mesh').columns).toEqual(SEARCH_COLUMNS);
        expect(registry.get('pubmed/journal').columns).toEqual(SEARCH_COLUMNS);
        expect(registry.get('pubmed/author').columns).toEqual(LINK_COLUMNS);
        expect(registry.get('pubmed/citations').columns).toEqual(LINK_COLUMNS);
        expect(registry.get('pubmed/related').columns).toEqual(RELATED_COLUMNS);
    });
});

describe('pubmed utility contracts', () => {
    it('rejects invalid PMIDs and silently-clamped limits', () => {
        expect(requirePmid('37780221')).toBe('37780221');
        expect(() => requirePmid('PMID:37780221')).toThrow(ArgumentError);
        expect(requireBoundedInt(undefined, 20, 100)).toBe(20);
        expect(requireBoundedInt('100', 20, 100)).toBe(100);
        expect(() => requireBoundedInt('2abc', 20, 100)).toThrow(ArgumentError);
        expect(() => requireBoundedInt(101, 20, 100)).toThrow(/<= 100/);
        expect(() => requireBoundedInt(0, 20, 100)).toThrow(ArgumentError);
    });

    it('builds E-utilities URLs with optional NCBI metadata', () => {
        vi.stubEnv('NCBI_API_KEY', 'key-1');
        vi.stubEnv('NCBI_EMAIL', 'dev@example.com');
        const url = buildEutilsUrl('esearch', { term: 'cancer', retmax: 5 });
        expect(url).toContain('/esearch.fcgi?');
        expect(url).toContain('db=pubmed');
        expect(url).toContain('api_key=key-1');
        expect(url).toContain('email=dev%40example.com');
        expect(url).toContain('term=cancer');
    });

    it('composes search filters without dropping date boundaries', () => {
        expect(buildSearchQuery('cancer', {
            author: 'Smith J',
            journal: 'Nature',
            yearFrom: 2020,
            yearTo: 2024,
            articleType: 'Review',
            hasAbstract: true,
            hasFullText: true,
            humanOnly: true,
            englishOnly: true,
        })).toBe('cancer AND Smith J[Author] AND Nature[Journal] AND 2020:2024[PDAT] AND Review[PT] AND hasabstract[text] AND free full text[sb] AND humans[mesh] AND english[lang]');
        expect(() => buildSearchQuery('cancer', { yearFrom: 2025, yearTo: 2020 })).toThrow(ArgumentError);
    });

    it('parses EFetch XML into article details', () => {
        const article = parseArticleXml(ARTICLE_XML, '123');
        expect(article.title).toBe('Detailed PubMed article & title.');
        expect(article.abstract).toBe('Background text. Conclusion text.');
        expect(article.authors).toEqual(['Alice Example', 'Bob B']);
        expect(article.journal).toBe('Journal of Tests');
        expect(article.doi).toBe('10.1000/detail');
        expect(article.mesh_terms).toBe('Neoplasms');
    });

    it('rejects EFetch XML whose PMID identity does not match the request', () => {
        expect(() => parseArticleXml(ARTICLE_XML.replace('>123</PMID>', '>456</PMID>'), '123')).toThrow(CommandExecutionError);
    });
});

describe('pubmed search command', () => {
    it('returns summary rows for ESearch ids', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123', '456'] } }))
            .mockResolvedValueOnce(jsonResponse(SUMMARY_RESULT)));
        const rows = await getRegistry().get('pubmed/search').func({ query: 'cancer', limit: 2, sort: 'date' });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rank: 1, pmid: '123', title: 'Cancer machine learning', article_type: 'Review', doi: '10.1000/test' });
        expect(rows[0].url).toBe('https://pubmed.ncbi.nlm.nih.gov/123/');
    });

    it('rejects bad query, limit, sort, and year args before fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const command = getRegistry().get('pubmed/search');
        await expect(command.func({ query: ' ', limit: 2 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'cancer', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'cancer', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'cancer', 'year-from': 2025, 'year-to': 2020 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps empty and API error envelopes to typed errors', async () => {
        const command = getRegistry().get('pubmed/search');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ query: 'nothing' })).rejects.toBeInstanceOf(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { errorlist: { phrasesnotfound: ['bad field'] } } })));
        await expect(command.func({ query: 'bad' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps HTTP, fetch, JSON, and partial summary failures to CommandExecutionError', async () => {
        const command = getRegistry().get('pubmed/search');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 500)));
        await expect(command.func({ query: 'cancer' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));
        await expect(command.func({ query: 'cancer' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new Error('bad json')) }));
        await expect(command.func({ query: 'cancer' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123', '456'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } })));
        await expect(command.func({ query: 'cancer' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('pubmed mesh command', () => {
    it('searches by MeSH term with optional major-topic filter', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await getRegistry().get('pubmed/mesh').func({ term: 'Neoplasms', major: true, limit: 1, sort: 'date' });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('Neoplasms%5BMajr%5D');
        expect(url).toContain('sort=pub_date');
    });

    it('rejects invalid mesh args and empty results', async () => {
        const command = getRegistry().get('pubmed/mesh');
        await expect(command.func({ term: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ term: 'Neoplasms', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ term: 'Neoplasms', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ term: 'Neoplasms' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed journal command', () => {
    it('searches by journal with optional year range and date sort', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await getRegistry().get('pubmed/journal').func({
            journal: 'Nature',
            'year-from': 2020,
            'year-to': 2024,
            sort: 'date',
            limit: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('Nature%5BJournal%5D');
        expect(url).toContain('2020%3A2024%5BPDAT%5D');
        expect(url).toContain('sort=pub_date');
    });

    it('rejects invalid journal args and empty results', async () => {
        const command = getRegistry().get('pubmed/journal');
        await expect(command.func({ journal: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ journal: 'Nature', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ journal: 'Nature', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ journal: 'Nature', 'year-from': 2025, 'year-to': 2020 })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ journal: 'Nature' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed article command', () => {
    it('returns a single structured row for a valid article', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(xmlResponse(ARTICLE_XML)));
        const rows = await getRegistry().get('pubmed/article').func({ pmid: '123' });
        expect(rows).toEqual([expect.objectContaining({
            pmid: '123',
            title: 'Detailed PubMed article & title.',
            authors: 'Alice Example, Bob B',
            journal: 'Journal of Tests',
            year: '2024',
            article_type: 'Review',
            doi: '10.1000/detail',
            pmc: 'PMC123',
            affiliations: 'Department of Oncology, SYSU. | State Key Laboratory of Oncology.',
            grants: '81972898: National Natural Science Foundation of China | 2024A1515010001: Guangdong Basic and Applied Basic Research Foundation',
            abstract: 'Background text. Conclusion text.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/123/',
        })]);
    });

    it('truncates long abstracts by default and expands them with --full-abstract', async () => {
        const command = getRegistry().get('pubmed/article');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(xmlResponse(LONG_ARTICLE_XML)));
        const truncatedRows = await command.func({ pmid: '555' });
        expect(truncatedRows[0].abstract.length).toBeLessThan(520);
        expect(truncatedRows[0].abstract.endsWith('...')).toBe(true);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(xmlResponse(LONG_ARTICLE_XML)));
        const fullRows = await command.func({ pmid: '555', 'full-abstract': true });
        expect(fullRows[0].abstract.length).toBeGreaterThan(800);
        expect(fullRows[0].abstract.endsWith('...')).toBe(false);
    });

    it('rejects invalid or missing articles with typed errors', async () => {
        const command = getRegistry().get('pubmed/article');
        await expect(command.func({ pmid: 'abc' })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(xmlResponse('<ERROR>not found</ERROR>')));
        await expect(command.func({ pmid: '123' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed clinical-trial command', () => {
    it('searches with the clinical-trial preset and optional free-full-text filter', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await getRegistry().get('pubmed/clinical-trial').func({
            query: 'breast cancer',
            'year-from': 2020,
            'year-to': 2024,
            'free-full-text': true,
            sort: 'date',
            limit: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('breast+cancer');
        expect(url).toContain('Clinical+Trial%5BPT%5D');
        expect(url).toContain('humans%5Bmesh%5D');
        expect(url).toContain('free+full+text%5Bsb%5D');
        expect(url).toContain('2020%3A2024%5BPDAT%5D');
        expect(url).toContain('sort=pub_date');
    });

    it('rejects invalid clinical-trial args and empty results', async () => {
        const command = getRegistry().get('pubmed/clinical-trial');
        await expect(command.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'breast cancer', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'breast cancer', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'breast cancer', 'year-from': 2025, 'year-to': 2020 })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ query: 'breast cancer' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed review command', () => {
    it('searches with the review preset and optional abstract filter', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await getRegistry().get('pubmed/review').func({
            query: 'immunotherapy',
            'year-from': 2021,
            'year-to': 2024,
            'has-abstract': true,
            sort: 'date',
            limit: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('immunotherapy');
        expect(url).toContain('Review%5BPT%5D');
        expect(url).toContain('hasabstract%5Btext%5D');
        expect(url).toContain('2021%3A2024%5BPDAT%5D');
        expect(url).toContain('sort=pub_date');
    });

    it('rejects invalid review args and empty results', async () => {
        const command = getRegistry().get('pubmed/review');
        await expect(command.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'immunotherapy', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'immunotherapy', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'immunotherapy', 'year-from': 2025, 'year-to': 2020 })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ query: 'immunotherapy' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed author command', () => {
    it('searches author position and affiliation filters', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: ['123'] } }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await getRegistry().get('pubmed/author').func({ name: 'Smith J', position: 'first', affiliation: 'Harvard', limit: 1 });
        expect(rows[0].pmid).toBe('123');
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('Smith+J%5B1au%5D');
        expect(url).toContain('Harvard%5Bad%5D');
    });

    it('rejects invalid author filters and empty results', async () => {
        const command = getRegistry().get('pubmed/author');
        await expect(command.func({ name: '', position: 'any' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ name: 'Smith', position: 'middle' })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ esearchresult: { idlist: [] } })));
        await expect(command.func({ name: 'Smith' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('pubmed citations and related commands', () => {
    it('returns cited-by summary rows with PMID round-trip ids', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ linksets: [{ linksetdbs: [{ links: ['123'] }] }] }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } })));
        const rows = await getRegistry().get('pubmed/citations').func({ pmid: '999', direction: 'citedby', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
    });

    it('rejects invalid citation args and empty relationships', async () => {
        const command = getRegistry().get('pubmed/citations');
        await expect(command.func({ pmid: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ pmid: '999', direction: 'sideways' })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ linksets: [{ linksetdbs: [] }] })));
        await expect(command.func({ pmid: '999', direction: 'citedby' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns related rows with optional score', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ linksets: [{ linksetdbs: [{ links: [{ id: '999', score: 999 }, { id: '123', score: 42 }] }] }] }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } })));
        const rows = await getRegistry().get('pubmed/related').func({ pmid: '999', score: true, limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ pmid: '123', score: 42 });
    });

    it('rejects invalid related args and empty related links', async () => {
        const command = getRegistry().get('pubmed/related');
        await expect(command.func({ pmid: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ pmid: '999', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ linksets: [{ linksetdbs: [{ links: [{ id: '999' }] }] }] })));
        await expect(command.func({ pmid: '999' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
