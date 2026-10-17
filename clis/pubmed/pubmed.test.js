import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildEutilsUrl, buildSearchQuery, parseArticleXml, requireBoundedInt, requirePmid } from './utils.js';
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

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
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

describe('pubmed citations and related commands', () => {
    it('returns cited-by summary rows with PMID round-trip ids', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ linksets: [{ linksetdbs: [{ links: ['123'] }] }] }))
            .mockResolvedValueOnce(jsonResponse({ result: { 123: SUMMARY_RESULT.result[123] } })));
        const rows = await getRegistry().get('pubmed/citations').func({ pmid: '999', direction: 'citedby', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0].pmid).toBe('123');
    });

});
