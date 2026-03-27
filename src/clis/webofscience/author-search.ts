import { cli, Strategy } from '../../registry.js';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '../../errors.js';

const AUTHOR_SEARCH_URL = 'https://webofscience.clarivate.cn/wos/author/author-search';
const AUTHOR_RESULTS_HINT = 'results from Web of Science Researchers';

type ClaimedStatus = 'claimed' | 'unclaimed';

export type AuthorSearchFilters = {
  claimedStatus?: ClaimedStatus;
  authors: string[];
  affiliations: string[];
  countries: string[];
  categories: string[];
  awardYears: string[];
  awardCategories: string[];
};

function splitAuthorQuery(query: string): { firstName: string; lastName: string } {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  if (normalized.includes(',')) {
    const [lastName, ...rest] = normalized.split(',');
    return {
      lastName: lastName.trim(),
      firstName: rest.join(' ').trim(),
    };
  }

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function splitCsv(value: unknown): string[] {
  const text = String(value ?? '');
  const delimiter = text.includes(';') ? ';' : ',';
  return text
    .split(delimiter)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeClaimedStatus(value: unknown): ClaimedStatus | undefined {
  if (value == null || value === '') return undefined;

  const normalized = String(value).trim().toLowerCase();
  if (['claimed', 'claim', 'profile', 'claimed-profile', 'claimed profiles', 'true'].includes(normalized)) {
    return 'claimed';
  }
  if (['unclaimed', 'unclaim', 'author-record', 'author records', 'unclaimed-profile', 'unclaimed profiles', 'false'].includes(normalized)) {
    return 'unclaimed';
  }

  throw new ArgumentError(`Unsupported Web of Science researcher claimed-status filter: ${String(value)}`);
}

export function normalizeAuthorSearchFilters(kwargs: Record<string, unknown>): AuthorSearchFilters {
  return {
    claimedStatus: normalizeClaimedStatus(kwargs['claimed-status']),
    authors: splitCsv(kwargs.author),
    affiliations: splitCsv(kwargs.affiliation),
    countries: splitCsv(kwargs.country),
    categories: splitCsv(kwargs.category),
    awardYears: splitCsv(kwargs['award-year']),
    awardCategories: splitCsv(kwargs['award-category']),
  };
}

function hasAuthorSearchFilters(filters: AuthorSearchFilters): boolean {
  return Boolean(
    filters.claimedStatus
    || filters.authors.length
    || filters.affiliations.length
    || filters.countries.length
    || filters.categories.length
    || filters.awardYears.length
    || filters.awardCategories.length,
  );
}

async function submitAuthorSearch(
  page: {
    evaluate: (js: string) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
  },
  query: { firstName: string; lastName: string },
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(`(async () => {
    const queryParts = ${JSON.stringify(query)};
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const setNativeValue = (input, value) => {
      if (!input) return false;
      const proto = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const findInput = (name, fallbackLabel) => {
      return document.querySelector('input[name="' + name + '"]')
        || Array.from(document.querySelectorAll('input[type="text"], input'))
          .find((el) => isVisible(el) && normalize(el.getAttribute('aria-label')) === normalize(fallbackLabel));
    };
    const selectSuggestion = async (value) => {
      if (!value) return true;
      const needle = normalize(value).toUpperCase();
      await sleep(350);
      const options = Array.from(document.querySelectorAll('[role="option"], mat-option'))
        .filter((el) => isVisible(el));
      const option = options.find((el) => normalize(el.textContent).toUpperCase() === needle)
        || options.find((el) => normalize(el.textContent).toUpperCase().startsWith(needle))
        || options.find((el) => normalize(el.textContent).toUpperCase().includes(needle));
      option?.click?.();
      await sleep(150);
      return Boolean(option);
    };
    const clickSearch = () => {
      const button = document.querySelector('button.search[type="submit"], button.search')
        || Array.from(document.querySelectorAll('button'))
          .find((el) => isVisible(el)
            && (
              String(el.getAttribute('aria-label') || '').trim().toLowerCase() === 'search'
              || normalize(el.textContent) === 'search'
            ));
      button?.click?.();
      return Boolean(button);
    };

    const lastNameInput = findInput('lastName', 'Last Name');
    const firstNameInput = findInput('firstName', 'First Name');
    if (!lastNameInput) throw new Error('Author search last-name input not found');

    setNativeValue(lastNameInput, queryParts.lastName);
    await selectSuggestion(queryParts.lastName);

    if (queryParts.firstName && firstNameInput) {
      setNativeValue(firstNameInput, queryParts.firstName);
      await selectSuggestion(queryParts.firstName);
    }

    if (!clickSearch()) {
      throw new Error('Author search submit button not found');
    }

    return true;
  })()`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.wait(2);
      }
    }
  }

  throw lastError;
}

async function waitForAuthorSearchLanding(
  page: {
    evaluate: (js: string) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
  },
): Promise<{ href: string; text: string }> {
  let lastState = { href: '', text: '' };

  for (let attempt = 0; attempt < 12; attempt++) {
    lastState = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000),
    }))()`);

    if (
      /\/wos\/author\/(summary|record)\//.test(lastState.href)
      || lastState.text.includes('${AUTHOR_RESULTS_HINT}')
      || /Search results/i.test(lastState.text)
    ) {
      return lastState;
    }

    await page.wait(1);
  }

  return lastState;
}

async function applyAuthorSearchFilters(
  page: {
    evaluate: (js: string) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
  },
  filters: AuthorSearchFilters,
): Promise<void> {
  const groups = [
    filters.claimedStatus ? { name: 'CLM', checkboxName: 'CLM', values: [filters.claimedStatus] } : null,
    filters.authors.length ? { name: 'AU', checkboxName: 'AU', values: filters.authors } : null,
    filters.affiliations.length ? { name: 'OG', checkboxName: 'OG', values: filters.affiliations } : null,
    filters.countries.length ? { name: 'CU', checkboxName: 'CU', values: filters.countries } : null,
    filters.categories.length ? { name: 'WC', checkboxName: 'WC', values: filters.categories } : null,
    (filters.awardYears.length || filters.awardCategories.length)
      ? { name: 'GRANTSAWARDED', checkboxName: 'FB', values: ['YES'] }
      : null,
    filters.awardYears.length ? { name: 'AY', checkboxName: 'AY', values: filters.awardYears } : null,
    filters.awardCategories.length ? { name: 'AC', checkboxName: 'AC', values: filters.awardCategories } : null,
  ].filter(Boolean) as Array<{ name: string; checkboxName: string; values: string[] }>;

  for (const group of groups) {
    const result = await page.evaluate(`(() => {
      const config = ${JSON.stringify({
        ...filters,
        currentGroup: group,
      })};
      const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const canonicalGroupValues = {
        CLM: {
          claimed: 'Claimed profiles',
          unclaimed: 'Unclaimed profiles',
        },
        GRANTSAWARDED: {
          yes: 'Includes awarded grants',
          true: 'Includes awarded grants',
        },
      };
      const checkboxName = config.currentGroup.checkboxName || config.currentGroup.name;
      const requested = Array.isArray(config.currentGroup.values) ? config.currentGroup.values : [];
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][name="' + checkboxName + '"]'));
      const labelOf = (checkbox) => {
        const aria = String(checkbox.getAttribute('aria-label') || '').trim();
        return aria.split('. ')[0].trim() || aria.split('.')[0].trim();
      };
      const valueOf = (checkbox) => {
        const raw = String(checkbox.value || '').trim();
        const idx = raw.indexOf('.');
        return idx >= 0 ? raw.slice(idx + 1) : raw;
      };
      const desiredLabels = requested.map((value) => {
        const mapped = canonicalGroupValues[checkboxName]?.[String(value).trim().toLowerCase()];
        return mapped || value;
      });
      const matches = (checkbox, target) => {
        const label = normalize(labelOf(checkbox));
        const value = normalize(valueOf(checkbox));
        const needle = normalize(target);
        return label === needle
          || value === needle
          || label.includes(needle)
          || value.includes(needle);
      };
      const findCheckbox = (target) => {
        return checkboxes.find((checkbox) => matches(checkbox, target)) || null;
      };
      const isRefineButton = (button) => {
        const aria = normalize(button.getAttribute('aria-label'));
        const text = normalize(button.textContent);
        return aria.includes('refine button') || text === 'refine';
      };
      const findRefineButton = (checkbox) => {
        let node = checkbox?.parentElement || null;
        while (node && node !== document.body) {
          const button = Array.from(node.querySelectorAll('button')).find((candidate) => isRefineButton(candidate));
          if (button) return button;
          node = node.parentElement;
        }
        return Array.from(document.querySelectorAll('button')).find((candidate) => isRefineButton(candidate)) || null;
      };

      const missing = [];
      let refineButton = null;
      for (const desiredLabel of desiredLabels) {
        const checkbox = findCheckbox(desiredLabel);
        if (!checkbox) {
          missing.push(desiredLabel);
          continue;
        }
        refineButton ||= findRefineButton(checkbox);
        if (!checkbox.checked) {
          checkbox.click();
        }
      }

      if (!missing.length && refineButton) {
        refineButton.click();
      }

      return { missing, applied: desiredLabels.filter(label => !missing.includes(label)) };
    })()`);

    if (Array.isArray(result?.missing) && result.missing.length) {
      if (['AY', 'AC'].includes(group.name)) {
        continue;
      }
      throw new ArgumentError(`Web of Science researcher filter not found in current refine options: ${result.missing.join(', ')}`);
    }

    await page.wait(4);
  }
}

async function scrapeAuthorResults(page: {
  evaluate: (js: string) => Promise<any>;
}): Promise<Array<{
  name?: string;
  details?: string;
  affiliations?: string[];
  location?: string;
  researcher_id?: string;
  published_names?: string[];
  top_journals?: string[];
  url?: string;
}>> {
  return page.evaluate(`(() => {
    const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a[href*="/wos/author/record/"]'));
    const seen = new Set();
    const results = [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const absolute = href.startsWith('http') ? href : new URL(href, location.origin).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      const card = link.closest('app-author-record, mat-card, article, li, [role="listitem"], .mat-mdc-card, .card, div');
      const name = normalize(link.textContent);
      const text = normalize(card?.textContent || '');
      const details = text
        .replace(name, '')
        .slice(0, 280);
      const infoLines = Array.from(card?.querySelectorAll?.('p.font-size-14:not(.meta-item)') || [])
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const affiliations = infoLines
        .filter((line) => line && !/, [A-Z]{2}, [A-Z]{3,}$/.test(line) && !/^[A-Z .'-]+, [A-Z]{2}, [A-Z]{3,}$/.test(line));
      const place = infoLines.find((line) => /, [A-Z]{2}, [A-Z]{3,}$/.test(line) || /^[A-Z .'-]+, [A-Z]{2}, [A-Z]{3,}$/.test(line)) || '';
      const researcherIdText = Array.from(card?.querySelectorAll?.('p.meta-item') || [])
        .map((node) => normalize(node.textContent))
        .find((line) => line.startsWith('Web of Science ResearcherID')) || '';
      const researcherId = researcherIdText.replace(/^Web of Science ResearcherID/i, '').trim();
      const publishedNamesText = Array.from(card?.querySelectorAll?.('p.meta-item') || [])
        .map((node) => normalize(node.textContent))
        .find((line) => line.startsWith('Published names')) || '';
      const publishedNames = Array.from(card?.querySelectorAll?.('.published-name span'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const topJournalsText = Array.from(card?.querySelectorAll?.('p.meta-item') || [])
        .map((node) => normalize(node.textContent))
        .find((line) => line.startsWith('Top Journals')) || '';
      const topJournals = topJournalsText
        .replace(/^Top Journals/i, '')
        .split(',')
        .map((item) => normalize(item))
        .filter(Boolean);
      if (name) {
        results.push({
          name,
          details,
          affiliations,
          location: place,
          researcher_id: researcherId,
          published_names: publishedNames,
          top_journals: topJournals,
          url: absolute,
        });
      }
    }
    return results;
  })()`) as Promise<Array<{ name?: string; details?: string; url?: string }>>;
}

cli({
  site: 'webofscience',
  name: 'author-search',
  description: 'Search Web of Science researcher profiles',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Researcher name or keyword' },
    { name: 'claimed-status', required: false, help: 'Refine by claimed status', choices: ['claimed', 'unclaimed'] },
    { name: 'author', required: false, help: 'Comma- or semicolon-separated author refine values' },
    { name: 'affiliation', required: false, help: 'Comma- or semicolon-separated affiliation refine values' },
    { name: 'country', required: false, help: 'Comma- or semicolon-separated country/region refine values' },
    { name: 'category', required: false, help: 'Comma- or semicolon-separated Web of Science categories / subject categories' },
    { name: 'award-year', required: false, help: 'Comma- or semicolon-separated award year refine values' },
    { name: 'award-category', required: false, help: 'Comma- or semicolon-separated award category refine values' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['rank', 'name', 'affiliations', 'location', 'researcher_id', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) {
      throw new ArgumentError('Search query is required');
    }

    const filters = normalizeAuthorSearchFilters(kwargs);
    const limit = Math.max(1, Math.min(50, Number(kwargs.limit ?? 10) || 10));
    const { firstName, lastName } = splitAuthorQuery(query);

    await page.goto(AUTHOR_SEARCH_URL, { settleMs: 4000 });
    await page.wait(2);
    await submitAuthorSearch(page, { firstName, lastName });

    const landing = await waitForAuthorSearchLanding(page);
    if (!/\/wos\/author\/(summary|record)\//.test(landing.href) && !landing.text.includes(AUTHOR_RESULTS_HINT)) {
      throw new CommandExecutionError(
        'Web of Science researcher search did not reach a results page',
        'The author search form may still be waiting for autocomplete confirmation or passive verification.',
      );
    }

    if (hasAuthorSearchFilters(filters)) {
      if (/\/wos\/author\/record\//.test(landing.href)) {
        throw new CommandExecutionError(
          'Web of Science opened a single researcher record before refine filters could be applied',
          'Broaden the query or remove the refine filters.',
        );
      }

      await applyAuthorSearchFilters(page, filters);
    }

    const scraped = await scrapeAuthorResults(page);
    const rows = (Array.isArray(scraped) ? scraped : [])
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        name: item.name ?? '',
        details: item.details ?? '',
        affiliations: Array.isArray(item.affiliations) ? item.affiliations : [],
        location: item.location ?? '',
        researcher_id: item.researcher_id ?? '',
        published_names: Array.isArray(item.published_names) ? item.published_names : [],
        top_journals: Array.isArray(item.top_journals) ? item.top_journals : [],
        url: item.url ?? '',
      }))
      .filter(item => item.name);

    if (!rows.length) {
      throw new EmptyResultError('webofscience author-search', 'Try a different researcher name or verify your Web of Science access in Chrome');
    }

    return rows;
  },
});
