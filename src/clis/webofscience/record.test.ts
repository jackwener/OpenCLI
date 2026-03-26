import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import { extractSupplementMetadataFromText } from './record.js';
import './record.js';

function createPageMock(evaluateResults: any[]): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

describe('webofscience record', () => {
  it('extracts structured metadata from full-record page text blocks', () => {
    const body = `Keywords
Keywords PlusNEURAL-NETWORKSSELECTION
Author Information
Corresponding Address
Lones, Michael A.
(corresponding author)
arrow_drop_down
Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Addresses
arrow_drop_down
1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Categories/ Classification
Research AreasComputer Science
Citation Topics
6 Social Sciences
Web of Science Categories
Computer Science, Artificial IntelligenceComputer Science, Information SystemsComputer Science, Interdisciplinary Applications
add
See more data fields
Journal information
PATTERNS
Research Areas
Computer Science
Web of Science Categories
Computer Science, Artificial IntelligenceComputer Science, Information SystemsComputer Science, Interdisciplinary Applications
7.4`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      corresponding_address: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
      author_addresses: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
      email_addresses: 'm.lones@hw.ac.uk',
      research_areas: 'Computer Science',
      wos_categories: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications',
    });
  });

  it('fetches a full record by UT using the ALLDB database when provided', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID555', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID555',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001335131500001',
              doi: '10.1016/j.patter.2024.101046',
              coll: 'WOSCC',
              titles: {
                item: { en: [{ title: 'Avoiding common machine learning pitfalls' }] },
                source: { en: [{ title: 'PATTERNS' }] },
              },
              names: {
                author: {
                  en: [
                    { wos_standard: 'Lones, M A' },
                    { wos_standard: 'Doe, J' },
                  ],
                },
              },
              pub_info: { pubyear: '2024' },
              citation_related: { counts: { WOSCC: 64, ALLDB: 81 } },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:001335131500001',
            doi: '10.1016/j.patter.2024.101046',
            coll: 'WOSCC',
            titles: {
              item: { en: [{ title: 'Avoiding common machine learning pitfalls' }] },
              source: { en: [{ title: 'PATTERNS' }] },
            },
            names: {
              author: {
                en: [
                  { wos_standard: 'Lones, M A' },
                  { wos_standard: 'Doe, J' },
                ],
              },
            },
            pub_info: {
              pubyear: '2024',
              sortdate: '2024-09-01',
            },
            abstract: {
              basic: {
                en: {
                  abstract: '<p>A concise <b>abstract</b> for testing.</p>',
                },
              },
            },
            keywords: {
              author_keywords: {
                en: [{ keyword: 'machine learning' }, { keyword: 'best practices' }],
              },
              keywords_plus: {
                en: [{ keyword: 'pitfalls' }],
              },
            },
            citation_related: {
              counts: {
                WOSCC: 64,
                ALLDB: 81,
              },
            },
          },
        },
      ],
      {
        metadata: {
          document_type: 'Review',
          article_number: '101046',
          published: 'OCT 11 2024',
          early_access: 'OCT 2024',
          indexed: '2024-10-25',
          language: 'English',
          pubmed_id: '39569205',
          issn: '2666-3899',
          ids_number: 'J1Z8Y',
          corresponding_address: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
          author_addresses: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
          email_addresses: 'm.lones@hw.ac.uk',
          research_areas: 'Computer Science',
          wos_categories: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications',
          current_publisher: 'CELL PRESS50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139',
          cited_references: '71',
        },
        fullTextLinks: [
          {
            label: 'Context Sensitive Links',
            url: 'https://webofscience.clarivate.cn/api/gateway?foo=1',
          },
          {
            label: 'Free Submitted Article From Repository',
            url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf',
          },
        ],
      },
    ]);

    const result = await cmd!.func!(page, { id: 'WOS:001335131500001', database: 'alldb' });

    expect(page.goto).toHaveBeenNthCalledWith(1,
      'https://webofscience.clarivate.cn/wos/alldb/smart-search',
      { settleMs: 4000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(2,
      'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001',
      { settleMs: 4000 },
    );

    const searchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(searchJs).toContain('"rowText":"UT=(WOS:001335131500001)"');
    expect(searchJs).toContain('"product":"ALLDB"');

    const fullRecordJs = vi.mocked(page.evaluate).mock.calls[2]?.[0];
    expect(fullRecordJs).toContain('/api/wosnx/core/getFullRecordByQueryId?SID=');
    expect(fullRecordJs).toContain('"qid":"QID555"');
    expect(fullRecordJs).toContain('"id":1');
    expect(fullRecordJs).toContain('"product":"ALLDB"');
    expect(fullRecordJs).toContain('"searchMode":"general_semantic"');

    expect(result).toEqual([
      { field: 'title', value: 'Avoiding common machine learning pitfalls' },
      { field: 'authors', value: 'Lones, M A; Doe, J' },
      { field: 'year', value: '2024' },
      { field: 'source', value: 'PATTERNS' },
      { field: 'doi', value: '10.1016/j.patter.2024.101046' },
      { field: 'ut', value: 'WOS:001335131500001' },
      { field: 'abstract', value: 'A concise abstract for testing.' },
      { field: 'document_type', value: 'Review' },
      { field: 'article_number', value: '101046' },
      { field: 'published', value: 'OCT 11 2024' },
      { field: 'early_access', value: 'OCT 2024' },
      { field: 'indexed', value: '2024-10-25' },
      { field: 'language', value: 'English' },
      { field: 'pubmed_id', value: '39569205' },
      { field: 'issn', value: '2666-3899' },
      { field: 'ids_number', value: 'J1Z8Y' },
      { field: 'corresponding_address', value: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland' },
      { field: 'author_addresses', value: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland' },
      { field: 'email_addresses', value: 'm.lones@hw.ac.uk' },
      { field: 'research_areas', value: 'Computer Science' },
      { field: 'wos_categories', value: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications' },
      { field: 'current_publisher', value: 'CELL PRESS50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139' },
      { field: 'author_keywords', value: 'machine learning; best practices' },
      { field: 'keywords_plus', value: 'pitfalls' },
      { field: 'citations_woscc', value: '64' },
      { field: 'citations_alldb', value: '81' },
      { field: 'cited_references', value: '71' },
      { field: 'full_text_links', value: 'Context Sensitive Links; Free Submitted Article From Repository' },
      { field: 'full_text_urls', value: 'https://webofscience.clarivate.cn/api/gateway?foo=1; https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf' },
      { field: 'url', value: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001' },
    ]);
  });

  it('accepts a full-record URL and infers the database from the path', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID777', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID777',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:009999999999999',
              coll: 'WOSCC',
              titles: {
                item: { en: [{ title: 'URL input record' }] },
              },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:009999999999999',
            titles: {
              item: { en: [{ title: 'URL input record' }] },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, {
      id: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:009999999999999',
    }) as Array<{ field: string; value: string }>;

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/smart-search',
      { settleMs: 4000 },
    );
    expect(result[0]).toEqual({ field: 'title', value: 'URL input record' });
  });

  it('throws for an unsupported record identifier', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([]);
    await expect(cmd!.func!(page, { id: 'not-a-record' })).rejects.toThrow(ArgumentError);
  });

  it('throws EmptyResultError when the exact record cannot be found', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID404', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID404',
            RecordsFound: 0,
          },
        },
        {
          key: 'records',
          payload: {},
        },
      ],
    ]);

    await expect(cmd!.func!(page, { id: 'WOS:001404' })).rejects.toThrow(EmptyResultError);
  });

  it('falls back to Enter when the submit button is unavailable', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      null,
      { sid: 'SIDENTER', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDENTER',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:003',
              titles: {
                item: { en: [{ title: 'Enter fallback record' }] },
              },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:003',
            titles: {
              item: { en: [{ title: 'Enter fallback record' }] },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.click).mockRejectedValueOnce(new Error('Element not found'));

    const result = await cmd!.func!(page, { id: 'WOS:003' });

    expect(page.pressKey).toHaveBeenCalledWith('Enter');
    expect(result).toBeTruthy();
  });

  it('falls back to the matched search record when full-record fetch fails', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDFB', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDFB',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:004',
              doi: '10.1000/fallback',
              titles: {
                item: { en: [{ title: 'Fallback summary record' }] },
                source: { en: [{ title: 'SUMMARY SOURCE' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Fallback, A' }],
                },
              },
              pub_info: { pubyear: '2023' },
              citation_related: {
                counts: {
                  WOSCC: 9,
                },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.evaluate).mockRejectedValueOnce(new Error('Unexpected token <'));

    const result = await cmd!.func!(page, { id: 'WOS:004' });

    expect(result).toEqual([
      { field: 'title', value: 'Fallback summary record' },
      { field: 'authors', value: 'Fallback, A' },
      { field: 'year', value: '2023' },
      { field: 'source', value: 'SUMMARY SOURCE' },
      { field: 'doi', value: '10.1000/fallback' },
      { field: 'ut', value: 'WOS:004' },
      { field: 'citations_woscc', value: '9' },
      { field: 'url', value: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:004' },
    ]);
  });
});
