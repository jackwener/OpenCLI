import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import './basic-search.js';

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

describe('webofscience basic-search', () => {
  it('uses the basic-search route and maps structured records', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      'opencli-search-input',
      { sid: 'SIDBASIC', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:101',
              doi: '10.1000/basic',
              titles: {
                item: { en: [{ title: 'Basic search result' }] },
                source: { en: [{ title: 'BASIC JOURNAL' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Basic, A' }],
                },
              },
              pub_info: { pubyear: '2025' },
              citation_related: { counts: { WOSCC: 5 } },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'basic', database: 'alldb', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/basic-search',
      { settleMs: 4000 },
    );
    const inputDiscoveryJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(inputDiscoveryJs).toContain('target.setAttribute(\'data-ref\', "opencli-search-input")');
    expect(inputDiscoveryJs).toContain('return "opencli-search-input"');
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Basic search result',
        authors: 'Basic, A',
        year: '2025',
        source: 'BASIC JOURNAL',
        citations: 5,
        doi: '10.1000/basic',
        url: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:101',
      },
    ]);
  });

  it('falls back to the visible basic-search submit button when the smart-search button is unavailable', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      'opencli-search-input',
      'opencli-search-submit',
      { sid: 'SIDBUTTON', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:102',
              titles: {
                item: { en: [{ title: 'Button submit result' }] },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.click).mockRejectedValueOnce(new Error('Element not found'));

    const result = await cmd!.func!(page, { query: 'button path', limit: 1 }) as Array<{ title: string }>;

    const submitDiscoveryJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(submitDiscoveryJs).toContain("const submitRef = 'opencli-search-submit'");
    expect(submitDiscoveryJs).toContain("target.setAttribute('data-ref', submitRef)");
    expect(page.click).toHaveBeenNthCalledWith(2, 'opencli-search-submit');
    expect(page.pressKey).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ title: 'Button submit result' });
  });

  it('throws EmptyResultError when no records are returned', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      'opencli-search-input',
      { sid: 'SIDEMPTY', href: 'https://webofscience.clarivate.cn/wos/woscc/basic-search' },
      [{ key: 'records', payload: {} }],
    ]);

    await expect(cmd!.func!(page, { query: 'none' })).rejects.toThrow(EmptyResultError);
  });
});
