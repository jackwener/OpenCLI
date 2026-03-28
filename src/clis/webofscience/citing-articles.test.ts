import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import './citing-articles.js';

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
    waitForCapture: vi.fn().mockResolvedValue(undefined),
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

describe('webofscience citing-articles', () => {
  it('loads a citing summary via the records stream endpoint', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        streamText: [
          '{"id":0,"key":"searchInfo","payload":{"QueryID":"QIDCITING","RecordsFound":64}}',
          '{"api":"runQueryGetRecordsStream","id":1,"key":"records","payload":{"1":{"ut":"WOS:002","doi":"10.1000/citing.1","titles":{"item":{"en":[{"title":"Citing article one"}]},"source":{"en":[{"title":"NATURE"}]}},"names":{"author":{"en":[{"wos_standard":"Smith, J"}]}},"pub_info":{"pubyear":"2026"},"citation_related":{"counts":{"WOSCC":12}}}}}',
        ].join('\n'),
        debug: {},
      },
    ]);

    const result = await cmd!.func!(page, { id: 'WOS:001335131500001', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001335131500001',
      { settleMs: 5000 },
    );

    const navigateJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(navigateJs).toContain('location.href');
    expect(navigateJs).toContain('citing-summary/WOS:001335131500001');

    const fetchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(fetchJs).toContain(`localStorage.getItem('wos_search_' + qid)`);
    expect(fetchJs).toContain(`searchState?.mode || "citing_article"`);
    expect(fetchJs).toContain(`/api/wosnx/core/runQueryGetRecordsStream?SID=`);

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Citing article one',
        authors: 'Smith, J',
        year: '2026',
        source: 'NATURE',
        citations: 12,
        doi: '10.1000/citing.1',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:002',
      },
    ]);
  });

  it('throws EmptyResultError when the citing summary response has no records', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      { streamText: '', debug: {} },
      { streamText: '', debug: {} },
    ]);

    await expect(cmd!.func!(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });
});
