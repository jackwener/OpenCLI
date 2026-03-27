import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import { buildBasicSearchRowText, isWosSubmitControl, normalizeBasicSearchField } from './shared.js';
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
  it('normalizes basic-search field aliases to official WOS tags', () => {
    expect(normalizeBasicSearchField(undefined)).toMatchObject({
      key: 'topic',
      label: 'Topic',
      tag: 'TS',
    });
    expect(normalizeBasicSearchField('title')).toMatchObject({
      key: 'title',
      label: 'Title',
      tag: 'TI',
    });
    expect(normalizeBasicSearchField('all-fields')).toMatchObject({
      key: 'all_fields',
      label: 'All Fields',
      tag: 'ALL',
    });
    expect(normalizeBasicSearchField('web-of-science-categories')).toMatchObject({
      key: 'web_of_science_categories',
      label: 'Web of Science Categories',
      tag: 'WC',
    });
  });

  it('builds rowText for basic-search fields using the mapped WOS tag', () => {
    expect(buildBasicSearchRowText('machine learning', 'topic')).toBe('TS=(machine learning)');
    expect(buildBasicSearchRowText('machine learning', 'title')).toBe('TI=(machine learning)');
    expect(buildBasicSearchRowText('10.1016/j.patter.2024.101046', 'doi')).toBe('DO=(10.1016/j.patter.2024.101046)');
    expect(buildBasicSearchRowText('Yann LeCun', 'author')).toBe('AU=(Yann LeCun)');
  });

  it('does not mistake history buttons for the actual search submit control', () => {
    expect(isWosSubmitControl({
      text: 'search Search',
      type: 'submit',
      ariaLabel: null,
    })).toBe(true);

    expect(isWosSubmitControl({
      text: 'View your search history',
      type: 'button',
      ariaLabel: null,
    })).toBe(false);
  });

  it('uses the basic-search route and maps structured records', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
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

    const result = await cmd!.func!(page, { query: 'basic', database: 'alldb', limit: 1, field: 'title' });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/basic-search',
      { settleMs: 4000 },
    );
    expect(page.typeText).toHaveBeenCalledWith('#search-option-0', 'basic');
    const searchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(searchJs).toContain('"rowText":"TI=(basic)"');
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

  it('prefers the stable basic-search textbox selector before generic discovery', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDPREFERRED', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:104',
              titles: {
                item: { en: [{ title: 'Preferred selector result' }] },
              },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'preferred field', limit: 1 }) as Array<{ title: string }>;

    expect(page.typeText).toHaveBeenCalledWith('#search-option-0', 'preferred field');
    expect(vi.mocked(page.evaluate).mock.calls[0]?.[0]).toContain("performance.getEntriesByType('resource')");
    expect(result[0]).toMatchObject({ title: 'Preferred selector result' });
  });

  it('falls back to the visible basic-search submit button when the smart-search button is unavailable', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
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

    const submitDiscoveryJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(submitDiscoveryJs).toContain("const submitRef = 'opencli-search-submit'");
    expect(submitDiscoveryJs).toContain("target.setAttribute('data-ref', submitRef)");
    expect(page.click).toHaveBeenNthCalledWith(2, 'opencli-search-submit');
    expect(page.pressKey).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ title: 'Button submit result' });
  });

  it('retries input discovery when the basic-search field renders late', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      null,
      'opencli-search-input',
      { sid: 'SIDLATE', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:103',
              titles: {
                item: { en: [{ title: 'Late field result' }] },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.typeText).mockRejectedValueOnce(new Error('Not ready'));

    const result = await cmd!.func!(page, { query: 'late field', limit: 1 }) as Array<{ title: string }>;

    expect(vi.mocked(page.evaluate).mock.calls[0]?.[0]).toContain('document.querySelectorAll(\'input, textarea\')');
    expect(vi.mocked(page.evaluate).mock.calls[1]?.[0]).toContain('document.querySelectorAll(\'input, textarea\')');
    expect(result[0]).toMatchObject({ title: 'Late field result' });
  });

  it('throws EmptyResultError when no records are returned', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDEMPTY', href: 'https://webofscience.clarivate.cn/wos/woscc/basic-search' },
      [{ key: 'records', payload: {} }],
    ]);

    await expect(cmd!.func!(page, { query: 'none' })).rejects.toThrow(EmptyResultError);
  });
});
