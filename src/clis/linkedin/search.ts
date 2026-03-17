import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

const EXPERIENCE_LEVELS: Record<string, string> = {
  internship: '1',
  entry: '2',
  'entry-level': '2',
  associate: '3',
  mid: '4',
  senior: '4',
  'mid-senior': '4',
  'mid-senior-level': '4',
  director: '5',
  executive: '6',
};

const JOB_TYPES: Record<string, string> = {
  'full-time': 'F',
  fulltime: 'F',
  full: 'F',
  'part-time': 'P',
  parttime: 'P',
  part: 'P',
  contract: 'C',
  temporary: 'T',
  temp: 'T',
  volunteer: 'V',
  internship: 'I',
  other: 'O',
};

const DATE_POSTED: Record<string, string> = {
  any: 'on',
  month: 'r2592000',
  'past-month': 'r2592000',
  week: 'r604800',
  'past-week': 'r604800',
  day: 'r86400',
  '24h': 'r86400',
  'past-24h': 'r86400',
};

const REMOTE_TYPES: Record<string, string> = {
  onsite: '1',
  'on-site': '1',
  hybrid: '3',
  remote: '2',
};

function parseCsvArg(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function mapFilterValues(input: unknown, mapping: Record<string, string>, label: string): string[] {
  const values = parseCsvArg(input);
  const resolved = values.map(value => {
    const key = value.toLowerCase();
    const mapped = mapping[key];
    if (!mapped) throw new Error(`Unsupported ${label}: ${value}`);
    return mapped;
  });
  return [...new Set(resolved)];
}

async function resolveCompanyIds(page: IPage, input: unknown): Promise<string[]> {
  const rawValues = parseCsvArg(input);
  const ids = new Set<string>();
  const names: string[] = [];

  for (const value of rawValues) {
    if (/^\d+$/.test(value)) ids.add(value);
    else names.push(value);
  }

  if (!names.length) return [...ids];

  const resolved = await page.evaluate(`(async () => {
    const targets = ${JSON.stringify(names)};
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = (value) => (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

    const openAllFilters = async () => {
      const button = [...document.querySelectorAll('button')]
        .find(b => ((b.innerText || '').trim().replace(/\s+/g, ' ')) === 'All filters');
      if (button) {
        button.click();
        await sleep(300);
      }
    };

    const companyMap = () => {
      const result = {};
      for (const input of document.querySelectorAll('input[name="company-filter-value"]')) {
        const value = input.value;
        const text = (input.parentElement?.innerText || input.closest('label')?.innerText || '').replace(/\s+/g, ' ').trim();
        const label = text.replace(/\s*Filter by.*$/i, '').trim();
        if (label) result[normalize(label)] = value;
      }
      return result;
    };

    const matchCompany = (map, name) => {
      const normalized = normalize(name);
      if (map[normalized]) return map[normalized];
      const key = Object.keys(map).find(entry => entry === normalized || entry.includes(normalized) || normalized.includes(entry));
      return key ? map[key] : null;
    };

    await openAllFilters();
    const results = {};
    let map = companyMap();

    for (const name of targets) {
      let found = matchCompany(map, name);
      if (!found) {
        const input = [...document.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === 'Add a company');
        if (input) {
          input.focus();
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
          await sleep(1200);
          map = companyMap();
          found = matchCompany(map, name);
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(100);
        }
      }
      results[name] = found || null;
    }

    return results;
  })()`);

  const unresolved: string[] = [];
  for (const name of names) {
    const id = resolved?.[name];
    if (id) ids.add(id);
    else unresolved.push(name);
  }

  if (unresolved.length) {
    throw new Error(`Could not resolve LinkedIn company filter: ${unresolved.join(', ')}`);
  }

  return [...ids];
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeLinkedinRedirect(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/redir/redirect/') {
      return parsed.searchParams.get('url') || url;
    }
  } catch {}
  return url;
}

async function enrichJobDetails(page: IPage, jobs: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
  const enriched: Array<Record<string, any>> = [];

  for (const job of jobs) {
    if (!job.url) {
      enriched.push({ ...job, description: '', apply_url: '' });
      continue;
    }

    try {
      await page.goto(job.url);
      await page.wait({ text: 'About the job', timeout: 8 });
      await page.evaluate(`(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const aboutSection = [...document.querySelectorAll('div, section, article')]
          .find((element) => normalize(element.querySelector('h1, h2, h3, h4')?.textContent || '') === 'about the job');
        const expandButton = [...(aboutSection?.querySelectorAll('button, a[role="button"]') || [])]
          .find((element) => /more/.test(normalize(element.textContent || '')) || /more/.test(normalize(element.getAttribute('aria-label') || '')));
        if (expandButton) expandButton.click();
      })()`);
      await page.wait(1);

      const detail = await page.evaluate(`(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const candidates = [...document.querySelectorAll('div, section, article')]
          .map((element) => {
            const heading = normalize(element.querySelector('h1, h2, h3, h4')?.textContent || '');
            const text = normalize(element.innerText || '');
            return { heading, text };
          })
          .filter((item) => item.text && item.heading.toLowerCase() === 'about the job' && item.text.length > 'About the job'.length)
          .sort((a, b) => a.text.length - b.text.length);

        const description = candidates[0]?.text.replace(/^About the job\s*/i, '') || '';
        const applyLink = [...document.querySelectorAll('a[href]')]
          .map((anchor) => ({
            href: anchor.href || '',
            text: normalize(anchor.textContent || ''),
            aria: normalize(anchor.getAttribute('aria-label') || ''),
          }))
          .find((anchor) => /apply/i.test(anchor.text) || /apply/i.test(anchor.aria));

        return {
          description,
          applyUrl: applyLink?.href || '',
        };
      })()`);

      enriched.push({
        ...job,
        description: normalizeWhitespace(detail?.description),
        apply_url: decodeLinkedinRedirect(String(detail?.applyUrl ?? '')),
      });
    } catch {
      enriched.push({ ...job, description: '', apply_url: '' });
    }
  }

  return enriched;
}

cli({
  site: 'linkedin',
  name: 'search',
  description: 'Search LinkedIn jobs',
  domain: 'www.linkedin.com',
  strategy: Strategy.HEADER,
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true, help: 'Job search keywords' },
    { name: 'location', type: 'string', required: false, help: 'Location text such as San Francisco Bay Area' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of jobs to return (max 100)' },
    { name: 'start', type: 'int', default: 0, help: 'Result offset for pagination' },
    { name: 'details', type: 'bool', default: false, help: 'Include full job description and apply URL (slower)' },
    { name: 'company', type: 'string', required: false, help: 'Comma-separated company names or LinkedIn company IDs' },
    { name: 'experience_level', type: 'string', required: false, help: 'Comma-separated: internship, entry, associate, mid-senior, director, executive' },
    { name: 'job_type', type: 'string', required: false, help: 'Comma-separated: full-time, part-time, contract, temporary, volunteer, internship, other' },
    { name: 'date_posted', type: 'string', required: false, help: 'One of: any, month, week, 24h' },
    { name: 'remote', type: 'string', required: false, help: 'Comma-separated: on-site, hybrid, remote' },
  ],
  columns: ['rank', 'title', 'company', 'location', 'listed', 'salary', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(kwargs.limit ?? 10, 100));
    const start = Math.max(0, kwargs.start ?? 0);
    const includeDetails = Boolean(kwargs.details);
    const location = (kwargs.location ?? '').trim();
    const keywords = String(kwargs.query ?? '').trim();
    const experienceLevels = mapFilterValues(kwargs.experience_level, EXPERIENCE_LEVELS, 'experience_level');
    const jobTypes = mapFilterValues(kwargs.job_type, JOB_TYPES, 'job_type');
    const remoteTypes = mapFilterValues(kwargs.remote, REMOTE_TYPES, 'remote');
    const datePostedValues = mapFilterValues(kwargs.date_posted, DATE_POSTED, 'date_posted');

    if (!keywords) throw new Error('query is required');

    const searchParams = new URLSearchParams({ keywords });
    if (location) searchParams.set('location', location);

    await page.goto(`https://www.linkedin.com/jobs/search/?${searchParams.toString()}`);
    await page.wait({ text: 'Jobs', timeout: 10 });
    const companyIds = await resolveCompanyIds(page, kwargs.company);

    const data = await page.evaluate(`(async () => {
      const input = ${JSON.stringify({
        keywords,
        location,
        limit,
        start,
        companyIds,
        experienceLevels,
        jobTypes,
        datePostedValues,
        remoteTypes,
      })};
      const maxBatchSize = 25;
      const jsession = document.cookie
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('JSESSIONID='))
        ?.slice('JSESSIONID='.length);

      if (!jsession) {
        return { error: 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.' };
      }

      const csrf = jsession.replace(/^"|"$/g, '');
      const headers = {
        'csrf-token': csrf,
        'x-restli-protocol-version': '2.0.0',
      };

      const buildSearchQuery = () => {
        const parts = [
          'origin:' + ((
            input.companyIds.length ||
            input.experienceLevels.length ||
            input.jobTypes.length ||
            input.datePostedValues.length ||
            input.remoteTypes.length
          ) ? 'JOB_SEARCH_PAGE_JOB_FILTER' : 'JOB_SEARCH_PAGE_OTHER_ENTRY'),
          'keywords:' + input.keywords,
        ];
        if (input.location) {
          parts.push('locationUnion:(seoLocation:(location:' + input.location + '))');
        }
        const filters = [];
        if (input.companyIds.length) filters.push('company:List(' + input.companyIds.join(',') + ')');
        if (input.experienceLevels.length) filters.push('experience:List(' + input.experienceLevels.join(',') + ')');
        if (input.jobTypes.length) filters.push('jobType:List(' + input.jobTypes.join(',') + ')');
        if (input.datePostedValues.length) filters.push('timePostedRange:List(' + input.datePostedValues.join(',') + ')');
        if (input.remoteTypes.length) filters.push('workplaceType:List(' + input.remoteTypes.join(',') + ')');
        if (filters.length) parts.push('selectedFilters:(' + filters.join(',') + ')');
        parts.push('spellCorrectionEnabled:true');
        return '(' + parts.join(',') + ')';
      };

      const buildUrl = (offset, count) => {
        const params = new URLSearchParams({
          decorationId: 'com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220',
          count: String(count),
          q: 'jobSearch',
        });
        const query = encodeURIComponent(buildSearchQuery())
          .replace(/%3A/gi, ':')
          .replace(/%2C/gi, ',')
          .replace(/%28/gi, '(')
          .replace(/%29/gi, ')');
        return '/voyager/api/voyagerJobsDashJobCards?' +
          params.toString() +
          '&query=' + query +
          '&start=' + offset;
      };

      const extractListed = (card) => {
        const listed = (card.footerItems || []).find(item => item?.type === 'LISTED_DATE' && item?.timeAt);
        return listed?.timeAt ? new Date(listed.timeAt).toISOString().slice(0, 10) : '';
      };

      const extractJobId = (card) => {
        const sources = [
          card.jobPostingUrn,
          card.jobPosting?.entityUrn,
          card.entityUrn,
        ].filter(Boolean);
        for (const source of sources) {
          const match = String(source).match(/(\d+)/);
          if (match) return match[1];
        }
        return '';
      };

      const collected = [];
      let offset = input.start;

      while (collected.length < input.limit) {
        const count = Math.min(maxBatchSize, input.limit - collected.length);
        const res = await fetch(buildUrl(offset, count), {
          credentials: 'include',
          headers,
        });

        if (!res.ok) {
          const text = await res.text();
          return { error: 'LinkedIn API error: HTTP ' + res.status + ' ' + text.slice(0, 200) };
        }

        const payload = await res.json();
        const elements = Array.isArray(payload?.elements) ? payload.elements : [];
        if (elements.length === 0) break;

        for (const element of elements) {
          const card = element?.jobCardUnion?.jobPostingCard;
          if (!card) continue;
          const jobId = extractJobId(card);
          collected.push({
            title: card.jobPostingTitle || card.title?.text || '',
            company: card.primaryDescription?.text || '',
            location: card.secondaryDescription?.text || '',
            listed: extractListed(card),
            salary: card.tertiaryDescription?.text || '',
            url: jobId ? 'https://www.linkedin.com/jobs/view/' + jobId : '',
          });
        }

        if (elements.length < count) break;
        offset += elements.length;
      }

      return collected.slice(0, input.limit).map((item, index) => ({
        rank: input.start + index + 1,
        ...item,
      }));
    })()`);

    if (!Array.isArray(data)) {
      throw new Error(data?.error || 'LinkedIn search returned an unexpected response');
    }

    if (!includeDetails) return data;

    return enrichJobDetails(page, data);
  },
});
