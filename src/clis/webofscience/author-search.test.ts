import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import { normalizeAuthorSearchFilters } from './author-search.js';
import './author-search.js';

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

describe('webofscience author-search', () => {
  it('normalizes researcher refine filters from comma-separated CLI args', () => {
    expect(normalizeAuthorSearchFilters({
      'claimed-status': 'claimed',
      author: 'Yann LeCun; LeCun, YANN',
      affiliation: 'Meta AI, NYU',
      country: 'USA, France',
      category: 'Computer Science, Mathematics',
      'award-year': '2024, 2025',
      'award-category': 'NIH, NSF',
    })).toEqual({
      claimedStatus: 'claimed',
      authors: ['Yann LeCun', 'LeCun, YANN'],
      affiliations: ['Meta AI', 'NYU'],
      countries: ['USA', 'France'],
      categories: ['Computer Science', 'Mathematics'],
      awardYears: ['2024', '2025'],
      awardCategories: ['NIH', 'NSF'],
    });
  });

  it('rejects unsupported claimed-status filters', () => {
    expect(() => normalizeAuthorSearchFilters({ 'claimed-status': 'maybe' })).toThrow(ArgumentError);
  });

  it('submits the author search page and maps researcher results', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        href: 'https://webofscience.clarivate.cn/wos/author/summary/demo/doc-relevance/1',
        text: '6 results from Web of Science Researchers for: Jane Doe',
      },
      [
        {
          name: 'Jane Doe',
          details: 'University of Testing Highly Cited Researcher',
          affiliations: ['University of Testing'],
          location: 'Boston, MA, USA',
          researcher_id: 'ABC-1234-2026',
          published_names: ['DOE, J', 'Jane Doe'],
          top_journals: ['TEST JOURNAL', 'EXAMPLE LETTERS'],
          url: 'https://webofscience.clarivate.cn/author/record/A-1234-2024',
        },
        {
          name: 'John Smith',
          details: 'Institute of Examples',
          url: 'https://webofscience.clarivate.cn/author/record/B-9999-2020',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'jane doe', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/author/author-search',
      { settleMs: 4000 },
    );
    const submitJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(submitJs).toContain(`input[name="' + name + '"]`);
    expect(submitJs).toContain(`findInput('lastName', 'Last Name')`);
    expect(submitJs).toContain(`findInput('firstName', 'First Name')`);
    expect(submitJs).toContain('selectSuggestion');
    expect(submitJs).toContain('"doe"');
    expect(submitJs).toContain('"jane"');
    expect(result).toEqual([
      {
        rank: 1,
        name: 'Jane Doe',
        details: 'University of Testing Highly Cited Researcher',
        affiliations: ['University of Testing'],
        location: 'Boston, MA, USA',
        researcher_id: 'ABC-1234-2026',
        published_names: ['DOE, J', 'Jane Doe'],
        top_journals: ['TEST JOURNAL', 'EXAMPLE LETTERS'],
        url: 'https://webofscience.clarivate.cn/author/record/A-1234-2024',
      },
    ]);
  });

  it('applies claimed-status and researcher facet filters before scraping', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        href: 'https://webofscience.clarivate.cn/wos/author/summary/demo/doc-relevance/1',
        text: '6 results from Web of Science Researchers for: Yann LeCun',
      },
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      [
        {
          name: 'Yann LeCun (LeCun, Yann)',
          details: 'Meta FAIR NEW YORK CITY, NY, USA',
          url: 'https://webofscience.clarivate.cn/wos/author/record/89895674',
        },
      ],
    ]);

    await cmd!.func!(page, {
      query: 'Yann LeCun',
      'claimed-status': 'claimed',
      affiliation: 'Meta',
      country: 'USA',
      category: 'Computer Science',
      author: 'Yann LECUN',
      'award-year': '2024',
      'award-category': 'NSF',
    });

    const filterJs = vi.mocked(page.evaluate).mock.calls[2]?.[0];
    expect(filterJs).toContain('"claimedStatus":"claimed"');
    expect(filterJs).toContain('"authors":["Yann LECUN"]');
    expect(filterJs).toContain('"affiliations":["Meta"]');
    expect(filterJs).toContain('"countries":["USA"]');
    expect(filterJs).toContain('"categories":["Computer Science"]');
    expect(filterJs).toContain('"awardYears":["2024"]');
    expect(filterJs).toContain('"awardCategories":["NSF"]');
    expect(filterJs).toContain('findCheckbox');
    expect(filterJs).toContain('findRefineButton');

    const awardFilterJs = vi.mocked(page.evaluate).mock.calls[7]?.[0];
    expect(awardFilterJs).toContain('"name":"GRANTSAWARDED"');

    const awardYearFilterJs = vi.mocked(page.evaluate).mock.calls[8]?.[0];
    expect(awardYearFilterJs).toContain('"awardYears":["2024"]');
    expect(awardYearFilterJs).toContain('"name":"AY"');

    const awardCategoryFilterJs = vi.mocked(page.evaluate).mock.calls[9]?.[0];
    expect(awardCategoryFilterJs).toContain('"awardCategories":["NSF"]');
    expect(awardCategoryFilterJs).toContain('"name":"AC"');
  });

  it('does not shadow the browser location object while scraping results', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        href: 'https://webofscience.clarivate.cn/wos/author/summary/demo/doc-relevance/1',
        text: '2 results from Web of Science Researchers for: Yann LeCun',
      },
      [],
    ]);

    await expect(cmd!.func!(page, { query: 'Yann LeCun', limit: 1 })).rejects.toThrow(EmptyResultError);

    const scrapeJs = vi.mocked(page.evaluate).mock.calls[2]?.[0];
    expect(scrapeJs).not.toContain('const location =');
    expect(scrapeJs).toContain('new URL(href, location.origin)');
  });

  it('keeps affiliation extraction separate from published names and top journals', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        href: 'https://webofscience.clarivate.cn/wos/author/summary/demo/doc-relevance/1',
        text: '2 results from Web of Science Researchers for: Yann LeCun',
      },
      [
        {
          name: 'Yann LeCun (LeCun, Yann)',
          details: 'Meta FAIR NEW YORK CITY, NY, USA',
          affiliations: ['Meta FAIR'],
          location: 'NEW YORK CITY, NY, USA',
          researcher_id: 'PQF-7882-2026',
          published_names: ['Yann LeCun'],
          top_journals: ['ARXIV'],
          url: 'https://webofscience.clarivate.cn/wos/author/record/89895674',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'Yann LeCun', limit: 1 });

    expect(result).toEqual([
      expect.objectContaining({
        affiliations: ['Meta FAIR'],
        published_names: ['Yann LeCun'],
        top_journals: ['ARXIV'],
      }),
    ]);

    const scrapeJs = vi.mocked(page.evaluate).mock.calls[2]?.[0];
    expect(scrapeJs).toContain('p.font-size-14:not(.meta-item)');
  });

  it('throws EmptyResultError when no authors are found', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      {
        href: 'https://webofscience.clarivate.cn/wos/author/summary/demo/doc-relevance/1',
        text: '0 results from Web of Science Researchers for: nobody',
      },
      [],
    ]);
    await expect(cmd!.func!(page, { query: 'nobody' })).rejects.toThrow(EmptyResultError);
  });
});
