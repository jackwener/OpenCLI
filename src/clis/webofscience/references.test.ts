import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import { parseWosEventStream } from './shared.js';
import './references.js';

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

describe('webofscience references', () => {
  it('parses summary stream payloads that arrive as a JSON array', () => {
    expect(parseWosEventStream(JSON.stringify([
      { key: 'searchInfo', payload: { QueryID: 'QIDREFS', RecordsFound: 2 } },
      { key: 'records', payload: { 1: { ut: 'WOS:001' }, 2: { ut: 'WOS:002' } } },
    ]))).toEqual([
      { key: 'searchInfo', payload: { QueryID: 'QIDREFS', RecordsFound: 2 } },
      { key: 'records', payload: { 1: { ut: 'WOS:001' }, 2: { ut: 'WOS:002' } } },
    ]);
  });

  it('loads a cited references summary via the records stream endpoint', async () => {
    const cmd = getRegistry().get('webofscience/references');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        streamText: [
          '{"id":0,"key":"searchInfo","payload":{"QueryID":"QIDREFS","RecordsFound":71}}',
          '{"api":"runQueryGetRecordsStream","id":1,"key":"records","payload":{"1":{"ut":"123456789","doi":"10.1000/ref.1","titles":{"source":{"en":[{"title":"SCIENCE"}]}},"names":{"author":{"en":[{"wos_standard":"Doe, J"}]}},"pub_info":{"pubyear":"2021"},"citation_related":{"counts":{"WOSCC":7}}}}}',
        ].join('\n'),
        debug: {},
      },
    ]);

    const result = await cmd!.func!(page, { id: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001',
      { settleMs: 5000 },
    );

    const navigateJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(navigateJs).toContain('location.href');
    expect(navigateJs).toContain('cited-references-summary/WOS:001335131500001');

    const fetchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(fetchJs).toContain(`localStorage.getItem('wos_search_' + qid)`);
    expect(fetchJs).toContain(`searchState?.mode || "cited_references"`);
    expect(fetchJs).toContain(`/api/wosnx/core/runQueryGetRecordsStream?SID=`);

    expect(result).toEqual([
      {
        rank: 1,
        title: 'SCIENCE',
        authors: 'Doe, J',
        year: '2021',
        source: 'SCIENCE',
        citations: 7,
        doi: '10.1000/ref.1',
        url: '',
      },
    ]);
  });

  it('throws EmptyResultError when the cited references summary has no records', async () => {
    const cmd = getRegistry().get('webofscience/references');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      { streamText: '', debug: {} },
      { streamText: '', debug: {} },
    ]);

    await expect(cmd!.func!(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });
});
