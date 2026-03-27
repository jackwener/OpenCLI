import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import {
  authorRecordUrl,
  parseAuthorRecordIdentifier,
} from './shared.js';

function normalizeText(value: string): string {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function lines(body: string): string[] {
  return String(body || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

type AuthorRecordScrape = {
  name?: string;
  displayName?: string;
  affiliations?: string[];
  location?: string;
  researcherId?: string;
  publishedNames?: string[];
  subjectCategories?: string[];
  coAuthors?: string[];
  metricsText?: string;
  links?: Array<{ label?: string; url?: string }>;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function metricLines(metricsText: string): string[] {
  return lines(metricsText);
}

function extractMetric(metricsText: string, patterns: RegExp[]): string {
  const all = metricLines(metricsText);
  for (const line of all) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return normalizeText(match[1]);
      }
    }
  }
  const whole = normalizeText(metricsText);
  for (const pattern of patterns) {
    const match = whole.match(pattern);
    if (match?.[1]) {
      return normalizeText(match[1]);
    }
  }
  return '';
}

function documentsMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Total documents$/i, /^Documents\s+(\d+)$/i, /^(\d+)\s+Documents$/i]);
}

function wosccPublicationsMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Web of Science Core Collection publications$/i]);
}

function preprintsMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Preprints$/i]);
}

function awardedGrantsMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Awarded grants$/i]);
}

function hIndexMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+H-Index$/i, /^(\d+)\s+h-index$/i]);
}

function publicationsRangeMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^([0-9]{4}\s*-\s*[0-9]{4})\s+Publications$/i]);
}

function timesCitedMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Sum of Times Cited$/i, /^(\d+)\s+Sum of times cited$/i]);
}

function citingArticlesMetric(metricsText: string): string {
  return extractMetric(metricsText, [/^(\d+)\s+Citing Articles$/i, /^(\d+)\s+Citing articles$/i]);
}

function normalizeLocation(value: string): string {
  const normalized = normalizeText(value);
  const tailMatch = normalized.match(/([A-Z][A-Z .'-]+,\s*[A-Z]{2},\s*[A-Z]{3,})$/);
  return normalizeText(tailMatch?.[1] || normalized);
}

async function scrapeAuthorRecord(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
    newTab?: () => Promise<any>;
  },
  url: string,
): Promise<AuthorRecordScrape> {
  const readOnce = () => page.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    const splitLines = (value) => String(value || '')
      .replace(/\\u00a0/g, ' ')
      .split('\\n')
      .map(line => normalize(line))
      .filter(Boolean);
    const unique = (values) => Array.from(new Set(values.map(value => normalize(value)).filter(Boolean)));
    const header = document.querySelector('app-author-record-header');
    const headerTokenTexts = Array.from(header?.querySelectorAll('h1, h2, h3, h4, em, span, a') || [])
      .map(node => normalize(node.textContent || ''))
      .filter(Boolean);
    const headerTexts = unique(headerTokenTexts.length ? headerTokenTexts : splitLines(header?.innerText || ''));
    const displayBlocks = Array.from(document.querySelectorAll('app-display-data'))
      .map((block) => {
        const spanTexts = Array.from(block.querySelectorAll('span, a, li, p'))
          .map(node => normalize(node.textContent || ''))
          .filter(Boolean);
        const lineTexts = splitLines(block instanceof HTMLElement ? block.innerText : block?.textContent || '');
        return unique(spanTexts.length ? spanTexts : lineTexts);
      })
      .filter(block => block.length);
    const metricRoot = document.querySelector('app-metrics-column');
    const metricsText = unique([
      ...Array.from(metricRoot?.querySelectorAll('span, a, li, p, div, h1, h2, h3, h4') || []).map(node => normalize(node.textContent || '')),
      ...splitLines(metricRoot instanceof HTMLElement ? metricRoot.innerText : metricRoot?.textContent || ''),
    ]).join('\\n');
    const section = (label) => {
      const lower = String(label || '').toLowerCase();
      for (const block of displayBlocks) {
        const index = block.findIndex(line => line.toLowerCase() === lower);
        if (index >= 0) {
          return unique(block.slice(index + 1));
        }
      }
      return [];
    };
    const name = normalize(header?.querySelector('h1')?.textContent || headerTexts[0] || '');
    const displayNameLine = headerTexts.find(line => /^\\(.+\\)$/.test(line)) || '';
    const displayName = normalize(displayNameLine.replace(/^\\(|\\)$/g, ''));
    const normalizeLocation = (value) => {
      const normalized = normalize(value);
      const tailMatch = normalized.match(/([A-Z][A-Z .'-]+,\\s*[A-Z]{2},\\s*[A-Z]{3,})$/);
      return normalize(tailMatch?.[1] || normalized);
    };
    const location = headerTexts
      .map(line => normalizeLocation(line))
      .find(line => /, [A-Z]{2}, [A-Z]{3,}$/.test(line) || /^[A-Z .'-]+, [A-Z]{2}, [A-Z]{3,}$/.test(line)) || '';
    const researcherId = headerTexts.find(line => /^[A-Z]{3}-\\d{4}-\\d{4}$/.test(line))
      || displayBlocks.flat().find(line => /^[A-Z]{3}-\\d{4}-\\d{4}$/.test(line))
      || '';
    const publishedNames = section('Published names');
    const organizations = section('Organizations');
    const subjectCategories = section('Subject Categories');
    const coAuthors = section('Co-authors');
    const affiliations = unique(organizations.length
      ? organizations
      : headerTexts.filter((line) => {
          return line
            && line !== name
            && line !== displayNameLine
            && line !== location
            && line !== researcherId
            && !/algorithmically generated author record/i.test(line)
            && line !== 'Web of Science ResearcherID';
        }));
    const links = Array.from(document.querySelectorAll('a'))
      .map((el) => ({
        label: normalize(el.textContent || el.getAttribute('aria-label') || ''),
        url: String((el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href')) || '').trim(),
      }))
      .filter((item) => item.url);

    return {
      name,
      displayName,
      affiliations,
      location,
      researcherId,
      publishedNames,
      subjectCategories,
      coAuthors,
      metricsText,
      links,
    };
  })()`);

  for (let round = 0; round < 2; round++) {
    if (round > 0 && typeof page.newTab === 'function') {
      await page.newTab();
    }
    await page.goto(url, { settleMs: 5000 });

    for (let attempt = 0; attempt < 3; attempt++) {
      await page.wait(2 + (attempt * 2));
      const result = (await readOnce()) as AuthorRecordScrape | undefined;
      const name = normalizeText(result?.name || '');
      const displayName = normalizeText(result?.displayName || '');
      const location = normalizeText(result?.location || '');
      const researcherId = normalizeText(result?.researcherId || '');
      const metricsText = String(result?.metricsText || '');
      if (name || researcherId || metricsText) {
        return {
          name,
          displayName,
          affiliations: unique(Array.isArray(result?.affiliations) ? result!.affiliations! : []),
          location,
          researcherId,
          publishedNames: unique(Array.isArray(result?.publishedNames) ? result!.publishedNames! : []),
          subjectCategories: unique(Array.isArray(result?.subjectCategories) ? result!.subjectCategories! : []),
          coAuthors: unique(Array.isArray(result?.coAuthors) ? result!.coAuthors! : []),
          metricsText,
          links: Array.isArray(result?.links) ? result!.links! : [],
        };
      }
    }
  }

  return {};
}

cli({
  site: 'webofscience',
  name: 'author-record',
  description: 'Fetch a Web of Science researcher author record',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'Author record id or author-record URL' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? '').trim();
    if (!rawId) throw new ArgumentError('Author record identifier is required');

    const identifier = parseAuthorRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError('Author record identifier must be a numeric id or author-record URL');
    }

    const url = authorRecordUrl(identifier.id);
    const scraped = await scrapeAuthorRecord(page, url);
    const name = normalizeText(scraped.name || '');
    const displayName = normalizeText(scraped.displayName || '');
    const affiliations = unique(scraped.affiliations || []);
    const location = normalizeText(scraped.location || '');
    const researcherId = normalizeText(scraped.researcherId || '');
    const publishedNames = unique(scraped.publishedNames || []);
    const subjectCategories = unique(scraped.subjectCategories || []);
    const coAuthors = unique(scraped.coAuthors || []);
    const metricsText = String(scraped.metricsText || '');
    const publicationsUrl = (scraped.links || []).find(link => /publications/i.test(link.label || '') && /general-summary/.test(link.url || ''))?.url || '';

    const rows = [
      { field: 'name', value: name },
      { field: 'display_name', value: displayName },
      { field: 'affiliations', value: affiliations.join('; ') },
      { field: 'location', value: location },
      { field: 'researcher_id', value: researcherId },
      { field: 'published_names', value: publishedNames.join('; ') },
      { field: 'subject_categories', value: subjectCategories.join('; ') },
      { field: 'documents', value: documentsMetric(metricsText) },
      { field: 'woscc_publications', value: wosccPublicationsMetric(metricsText) },
      { field: 'preprints', value: preprintsMetric(metricsText) },
      { field: 'awarded_grants', value: awardedGrantsMetric(metricsText) },
      { field: 'h_index', value: hIndexMetric(metricsText) },
      { field: 'publications_range', value: publicationsRangeMetric(metricsText) },
      { field: 'times_cited', value: timesCitedMetric(metricsText) },
      { field: 'citing_articles', value: citingArticlesMetric(metricsText) },
      { field: 'co_authors', value: coAuthors.join('; ') },
      { field: 'publications_url', value: publicationsUrl },
      { field: 'url', value: url },
    ].filter(row => row.value);

    if (!rows.length || !name) {
      throw new EmptyResultError('webofscience author-record', 'Try opening the author record in Chrome once, then run again.');
    }

    return rows;
  },
});
