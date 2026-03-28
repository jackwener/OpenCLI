import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import './author-record.js';

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

describe('webofscience author-record', () => {
  it('extracts a structured researcher profile from selector-driven page data', async () => {
    const cmd = getRegistry().get('webofscience/author-record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      {
        name: 'Yann LeCun',
        displayName: 'LeCun, Yann',
        affiliations: ['Meta FAIR', 'New York University'],
        location: 'NEW YORK CITY, NY, USA',
        researcherId: 'PQF-7882-2026',
        publishedNames: ['LECUN, Y', 'Yann LeCun'],
        subjectCategories: ['Computer Science', 'Artificial Intelligence'],
        coAuthors: ['Yoshua Bengio', 'Geoffrey Hinton'],
        metricsText: `147 Total documents
12 Web of Science Core Collection publications
135 Preprints
3 Awarded grants
64 H-Index
1989-2025 Publications
152345 Sum of Times Cited
87211 Citing Articles`,
        links: [
          { label: 'Web of Science Core Collection publications', url: 'https://webofscience.clarivate.cn/wos/woscc/general-summary/x' },
        ],
      },
    ]);

    const result = await cmd!.func!(page, { id: '89895674' });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/author/record/89895674',
      { settleMs: 5000 },
    );
    const scrapeJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(scrapeJs).toContain('app-author-record-header');
    expect(scrapeJs).toContain('app-display-data');
    expect(scrapeJs).toContain('app-metrics-column');

    expect(result).toEqual([
      { field: 'name', value: 'Yann LeCun' },
      { field: 'display_name', value: 'LeCun, Yann' },
      { field: 'affiliations', value: 'Meta FAIR; New York University' },
      { field: 'location', value: 'NEW YORK CITY, NY, USA' },
      { field: 'researcher_id', value: 'PQF-7882-2026' },
      { field: 'published_names', value: 'LECUN, Y; Yann LeCun' },
      { field: 'subject_categories', value: 'Computer Science; Artificial Intelligence' },
      { field: 'documents', value: '147' },
      { field: 'woscc_publications', value: '12' },
      { field: 'preprints', value: '135' },
      { field: 'awarded_grants', value: '3' },
      { field: 'h_index', value: '64' },
      { field: 'publications_range', value: '1989-2025' },
      { field: 'times_cited', value: '152345' },
      { field: 'citing_articles', value: '87211' },
      { field: 'co_authors', value: 'Yoshua Bengio; Geoffrey Hinton' },
      { field: 'publications_url', value: 'https://webofscience.clarivate.cn/wos/woscc/general-summary/x' },
      { field: 'url', value: 'https://webofscience.clarivate.cn/wos/author/record/89895674' },
    ]);
  });

  it('accepts an author record URL as input', async () => {
    const cmd = getRegistry().get('webofscience/author-record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { name: 'Yann LeCun', researcherId: 'PQF-7882-2026', metricsText: '', links: [] },
    ]);

    await cmd!.func!(page, { id: 'https://webofscience.clarivate.cn/wos/author/record/89895674' });
    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/author/record/89895674',
      { settleMs: 5000 },
    );
  });

  it('rejects unsupported author record identifiers', async () => {
    const cmd = getRegistry().get('webofscience/author-record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([]);
    await expect(cmd!.func!(page, { id: 'not-a-record' })).rejects.toThrow(ArgumentError);
  });

  it('throws EmptyResultError when the author record page contains no usable profile data', async () => {
    const cmd = getRegistry().get('webofscience/author-record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { name: '', researcherId: '', metricsText: '', links: [] },
    ]);

    await expect(cmd!.func!(page, { id: '89895674' })).rejects.toThrow(EmptyResultError);
  });
});
