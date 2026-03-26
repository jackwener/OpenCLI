import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import './smart-search.js';

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

describe('webofscience smart-search', () => {
  it('retries once when SID is missing, then maps records from runQuerySearch', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: null, href: 'https://webofscience.clarivate.cn/wos/woscc/smart-search' },
      { sid: 'SID123', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID123',
            RecordsFound: 685661,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001335131500001',
              doi: '10.1016/j.patter.2024.101046',
              titles: {
                item: { en: [{ title: 'Avoiding common machine learning pitfalls' }] },
                source: { en: [{ title: 'PATTERNS' }] },
              },
              names: {
                author: {
                  en: [
                    { first_name: 'Michael A.', last_name: 'Lones' },
                    { wos_standard: 'Doe, J' },
                  ],
                },
              },
              pub_info: { pubyear: '2024' },
              citation_related: { counts: { WOSCC: 64 } },
            },
            2: {
              ut: 'WOS:001527924800002',
              doi: '',
              titles: {
                item: { en: [{ title: 'Another machine learning paper' }] },
                source: { en: [{ title: 'JOURNAL OF TESTS' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Smith, A' }],
                },
              },
              pub_info: { pubyear: '2025' },
              citation_related: { counts: { WOSCC: 7 } },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'machine learning', limit: 2 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/woscc/smart-search',
      { settleMs: 4000 },
    );
    expect(page.typeText).toHaveBeenCalledWith('#composeQuerySmartSearch', 'machine learning');
    expect(page.click).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Avoiding common machine learning pitfalls',
        authors: 'Lones, Michael A.; Doe, J',
        year: '2024',
        source: 'PATTERNS',
        citations: 64,
        doi: '10.1016/j.patter.2024.101046',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001335131500001',
      },
      {
        rank: 2,
        title: 'Another machine learning paper',
        authors: 'Smith, A',
        year: '2025',
        source: 'JOURNAL OF TESTS',
        citations: 7,
        doi: '',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001527924800002',
      },
    ]);
  });

  it('throws EmptyResultError when the records payload is empty', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID123', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID123',
            RecordsFound: 0,
          },
        },
        {
          key: 'records',
          payload: {},
        },
      ],
    ]);

    await expect(cmd!.func!(page, { query: 'nohits', limit: 5 })).rejects.toThrow(EmptyResultError);
    expect(page.click).toHaveBeenCalledTimes(1);
  });

  it('uses the ALLDB smart-search route and payload when database=alldb', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID999', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID999',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:009999999999999',
              doi: '10.1000/alldb.1',
              titles: {
                item: { en: [{ title: 'All databases record' }] },
                source: { en: [{ title: 'MULTIDATABASE JOURNAL' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Zhang, S' }],
                },
              },
              pub_info: { pubyear: '2026' },
              citation_related: { counts: { WOSCC: 3 } },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'quantum', database: 'alldb', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/smart-search',
      { settleMs: 4000 },
    );

    const runQuerySearchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(runQuerySearchJs).toContain('/api/wosnx/core/runQuerySearch?SID=');
    expect(runQuerySearchJs).toContain('"product":"ALLDB"');
    expect(runQuerySearchJs).toContain('"database":"ALLDB"');

    expect(result).toEqual([
      {
        rank: 1,
        title: 'All databases record',
        authors: 'Zhang, S',
        year: '2026',
        source: 'MULTIDATABASE JOURNAL',
        citations: 3,
        doi: '10.1000/alldb.1',
        url: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:009999999999999',
      },
    ]);
  });

  it('skips null authors when formatting records', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID321', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001',
              titles: {
                item: { en: [{ title: 'Null author test' }] },
              },
              names: {
                author: {
                  en: [null, { wos_standard: 'Doe, J' }, null],
                },
              },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'test', limit: 1 });

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Null author test',
        authors: 'Doe, J',
        year: '',
        source: '',
        citations: 0,
        doi: '',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001',
      },
    ]);
  });

  it('falls back to Enter when the submit button is unavailable', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      null,
      { sid: 'SID654', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:002',
              titles: {
                item: { en: [{ title: 'Fallback submit test' }] },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.click).mockRejectedValueOnce(new Error('Element not found'));

    const result = await cmd!.func!(page, { query: 'fallback', limit: 1 }) as Array<{ title: string }>;

    expect(page.pressKey).toHaveBeenCalledWith('Enter');
    expect(result[0]).toMatchObject({ title: 'Fallback submit test' });
  });

  it('retries typing when the search input is not ready on first attempt', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      'opencli-search-input',
      { sid: 'SID765', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:005',
              titles: {
                item: { en: [{ title: 'Retry input test' }] },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.typeText).mockRejectedValueOnce(new Error('Element not found'));

    const result = await cmd!.func!(page, { query: 'retry', limit: 1 }) as Array<{ title: string }>;

    expect(page.typeText).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ title: 'Retry input test' });
  });

  it('does not keep the legacy search command registered', () => {
    expect(getRegistry().get('webofscience/search')).toBeUndefined();
  });
});
