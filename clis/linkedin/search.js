import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
const LINKEDIN_DOMAIN = 'linkedin.com';
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MIN_START = 0;
// ── Filter value mappings ──────────────────────────────────────────────
const EXPERIENCE_LEVELS = {
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
const JOB_TYPES = {
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
const DATE_POSTED = {
    any: 'on',
    month: 'r2592000',
    'past-month': 'r2592000',
    week: 'r604800',
    'past-week': 'r604800',
    day: 'r86400',
    '24h': 'r86400',
    'past-24h': 'r86400',
};
const REMOTE_TYPES = {
    onsite: '1',
    'on-site': '1',
    hybrid: '3',
    remote: '2',
};
// ── Helpers ────────────────────────────────────────────────────────────
function parseCsvArg(value) {
    if (value === undefined || value === null || value === '')
        return [];
    return String(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}
function mapFilterValues(input, mapping, label) {
    const values = parseCsvArg(input);
    const resolved = values.map(value => {
        const key = value.toLowerCase();
        const mapped = mapping[key];
        if (!mapped)
            throw new ArgumentError(`Unsupported ${label}: ${value}`);
        return mapped;
    });
    return [...new Set(resolved)];
}
function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function parseIntegerArg(value, label, fallback, min, max = Infinity) {
    if (value === undefined || value === null || value === '')
        return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`${label} must be an integer, got ${JSON.stringify(value)}`);
    }
    if (parsed < min || parsed > max) {
        const range = Number.isFinite(max) ? `between ${min} and ${max}` : `at least ${min}`;
        throw new ArgumentError(`${label} must be ${range}, got ${parsed}`);
    }
    return parsed;
}
function decodeLinkedinRedirect(url) {
    if (!url)
        return '';
    try {
        const parsed = new URL(url);
        if (parsed.pathname === '/redir/redirect/') {
            return parsed.searchParams.get('url') || url;
        }
    }
    catch { }
    return url;
}
function buildVoyagerSearchQuery(input) {
    const hasFilters = input.companyIds.length ||
        input.experienceLevels.length ||
        input.jobTypes.length ||
        input.datePostedValues.length ||
        input.remoteTypes.length;
    const parts = [
        'origin:' + (hasFilters ? 'JOB_SEARCH_PAGE_JOB_FILTER' : 'JOB_SEARCH_PAGE_OTHER_ENTRY'),
        'keywords:' + input.keywords,
    ];
    if (input.location) {
        parts.push('locationUnion:(seoLocation:(location:' + input.location + '))');
    }
    const filters = [];
    if (input.companyIds.length)
        filters.push('company:List(' + input.companyIds.join(',') + ')');
    if (input.experienceLevels.length)
        filters.push('experience:List(' + input.experienceLevels.join(',') + ')');
    if (input.jobTypes.length)
        filters.push('jobType:List(' + input.jobTypes.join(',') + ')');
    if (input.datePostedValues.length)
        filters.push('timePostedRange:List(' + input.datePostedValues.join(',') + ')');
    if (input.remoteTypes.length)
        filters.push('workplaceType:List(' + input.remoteTypes.join(',') + ')');
    if (filters.length)
        parts.push('selectedFilters:(' + filters.join(',') + ')');
    parts.push('spellCorrectionEnabled:true');
    return '(' + parts.join(',') + ')';
}
function buildVoyagerUrl(input, offset, count) {
    const params = new URLSearchParams({
        decorationId: 'com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220',
        count: String(count),
        q: 'jobSearch',
    });
    const query = encodeURIComponent(buildVoyagerSearchQuery(input))
        .replace(/%3A/gi, ':')
        .replace(/%2C/gi, ',')
        .replace(/%28/gi, '(')
        .replace(/%29/gi, ')');
    return '/voyager/api/voyagerJobsDashJobCards?' + params.toString() + '&query=' + query + '&start=' + offset;
}
function looksLinkedInAuthWallText(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text)
        return false;
    return /\b(sign in|log in|join linkedin)\b/.test(text) ||
        /linkedin\.com\/(login|checkpoint|authwall)/i.test(text) ||
        /\b(captcha|verification required)\b/.test(text) ||
        /(请登录|登录领英|安全验证)/.test(text);
}
function buildLinkedInAuthProbeScript() {
    return `(() => {
      const text = [
        window.location.href || '',
        document.title || '',
        document.body ? (document.body.innerText || '').slice(0, 4000) : '',
      ].join('\\n');
      return ${looksLinkedInAuthWallText.toString()}(text);
    })()`;
}
async function assertLinkedInAuthenticated(page, context) {
    const authRequired = await page.evaluate(buildLinkedInAuthProbeScript());
    if (authRequired) {
        throw new AuthRequiredError(LINKEDIN_DOMAIN, `${context} requires an active signed-in LinkedIn browser session`);
    }
}
// ── Company ID resolution (requires DOM interaction) ──────────────────
async function resolveCompanyIds(page, input) {
    const rawValues = parseCsvArg(input);
    const ids = new Set();
    const names = [];
    for (const value of rawValues) {
        if (/^\d+$/.test(value))
            ids.add(value);
        else
            names.push(value);
    }
    if (!names.length)
        return [...ids];
    const resolved = await page.evaluate(`(async () => {
    const targets = ${JSON.stringify(names)};
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = (v) => (v || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    // Open "All filters" panel to expose company filter inputs
    const allBtn = [...document.querySelectorAll('button')]
      .find(b => ((b.innerText || '').trim().replace(/\\s+/g, ' ')) === 'All filters');
    if (allBtn) { allBtn.click(); await sleep(300); }

    const getCompanyMap = () => {
      const map = {};
      for (const el of document.querySelectorAll('input[name="company-filter-value"]')) {
        const text = (el.parentElement?.innerText || el.closest('label')?.innerText || '')
          .replace(/\\s+/g, ' ').trim().replace(/\\s*Filter by.*$/i, '').trim();
        if (text) map[normalize(text)] = el.value;
      }
      return map;
    };

    const match = (map, name) => {
      const n = normalize(name);
      if (map[n]) return map[n];
      const k = Object.keys(map).find(e => e === n || e.includes(n) || n.includes(e));
      return k ? map[k] : null;
    };

    const results = {};
    let map = getCompanyMap();

    for (const name of targets) {
      let found = match(map, name);
      if (!found) {
        const inp = [...document.querySelectorAll('input')]
          .find(el => el.getAttribute('aria-label') === 'Add a company');
        if (inp) {
          inp.focus();
          inp.value = name;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
          await sleep(1200);
          map = getCompanyMap();
          found = match(map, name);
          inp.value = '';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(100);
        }
      }
      results[name] = found || null;
    }
    return results;
  })()`);
    const unresolved = [];
    for (const name of names) {
        const id = resolved?.[name];
        if (id)
            ids.add(id);
        else
            unresolved.push(name);
    }
    if (unresolved.length) {
        throw new ArgumentError(`Could not resolve LinkedIn company filter: ${unresolved.join(', ')}`);
    }
    return [...ids];
}
// ── Voyager API fetch (runs inside page context for cookie access) ────
async function fetchJobCards(page, input) {
    const MAX_BATCH = 25;
    const allJobs = [];
    let offset = input.start;
    // Read JSESSIONID directly from the cookie store via CDP — zero page.evaluate round-trip
    const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
    const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    if (!jsession) {
        throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
    }
    const csrf = jsession.replace(/^"|"$/g, '');
    while (allJobs.length < input.limit) {
        const count = Math.min(MAX_BATCH, input.limit - allJobs.length);
        const apiPath = buildVoyagerUrl(input, offset, count);
        const batch = await page.evaluate(`(async () => {
      const res = await fetch(${JSON.stringify(apiPath)}, {
        credentials: 'include',
        headers: { 'csrf-token': ${JSON.stringify(csrf)}, 'x-restli-protocol-version': '2.0.0' },
      });
      if (res.status === 401 || res.status === 403) {
        const text = await res.text();
        return {
          authRequired: true,
          error: 'LinkedIn API authentication failed: HTTP ' + res.status + ' ' + text.slice(0, 200)
        };
      }
      if (!res.ok) {
        const text = await res.text();
        return { error: 'LinkedIn API error: HTTP ' + res.status + ' ' + text.slice(0, 200) };
      }
      return res.json();
    })()`);
        if (!batch || batch.error) {
            if (batch?.authRequired) {
                throw new AuthRequiredError(LINKEDIN_DOMAIN, batch.error);
            }
            throw new CommandExecutionError(batch?.error || 'LinkedIn search returned an unexpected response');
        }
        const elements = Array.isArray(batch?.elements) ? batch.elements : [];
        if (elements.length === 0)
            break;
        for (const element of elements) {
            const card = element?.jobCardUnion?.jobPostingCard;
            if (!card)
                continue;
            // Extract job ID from URN fields
            const jobId = [card.jobPostingUrn, card.jobPosting?.entityUrn, card.entityUrn]
                .filter(Boolean)
                .map(s => String(s).match(/(\d+)/)?.[1])
                .find(Boolean) ?? '';
            // Extract listed date
            const listedItem = (card.footerItems || []).find((i) => i?.type === 'LISTED_DATE' && i?.timeAt);
            const listed = listedItem?.timeAt ? new Date(listedItem.timeAt).toISOString().slice(0, 10) : '';
            allJobs.push({
                title: card.jobPostingTitle || card.title?.text || '',
                company: card.primaryDescription?.text || '',
                location: card.secondaryDescription?.text || '',
                listed,
                salary: card.tertiaryDescription?.text || '',
                url: jobId ? 'https://www.linkedin.com/jobs/view/' + jobId : '',
            });
        }
        if (elements.length < count)
            break;
        offset += elements.length;
    }
    return allJobs.slice(0, input.limit).map((item, index) => ({
        rank: input.start + index + 1,
        ...item,
    }));
}
// ── Job detail enrichment (--details flag) ────────────────────────────
//
// Per-row failures should NOT abort the whole list (--details enriches N rows;
// partial failure is expected). But silent empty-string fields hide the failure
// from callers — previously `catch {}` and the `if (!job.url)` early-return
// both produced indistinguishable `description: '', apply_url: ''` payloads,
// so users could not tell "fetch failed" from "upstream had no description".
//
// The fix: surface `null` instead of `''` for missing/failed rows, set
// `detail_error` to a short reason ("no url" / "fetch failed: <message>" /
// "missing description"), and log every failure to stderr with the offending
// URL so debugging is possible. Successful rows have `detail_error: null`.
async function enrichJobDetails(page, jobs) {
    const enriched = [];
    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        console.error(`[opencli:linkedin] Fetching details ${i + 1}/${jobs.length}: ${job.title}`);
        if (!job.url) {
            const reason = 'no url';
            console.error(`[opencli:linkedin] Skipping detail for "${job.title}": ${reason}`);
            enriched.push({ ...job, description: null, apply_url: null, detail_error: reason });
            continue;
        }
        try {
            await page.goto(job.url);
            await assertLinkedInAuthenticated(page, 'LinkedIn job detail');
            await page.wait({ text: 'About the job', timeout: 8 });
            // Expand "Show more" button if present
            await page.evaluate(`(() => {
        const norm = (v) => (v || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const section = [...document.querySelectorAll('div, section, article')]
          .find(el => norm(el.querySelector('h1,h2,h3,h4')?.textContent || '') === 'about the job');
        const btn = [...(section?.querySelectorAll('button, a[role="button"]') || [])]
          .find(el => /more/.test(norm(el.textContent || '')) || /more/.test(norm(el.getAttribute('aria-label') || '')));
        if (btn) btn.click();
      })()`);
            await page.wait(1);
            // Extract description and apply URL
            const detail = await page.evaluate(`(() => {
        const norm = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        // Find the most specific (shortest) container with "About the job" heading
        // Shortest = most specific DOM node, avoiding outer wrappers that include unrelated text
        const candidates = [...document.querySelectorAll('div, section, article')]
          .map(el => ({
            heading: norm(el.querySelector('h1,h2,h3,h4')?.textContent || ''),
            text: norm(el.innerText || ''),
          }))
          .filter(c => c.text && c.heading.toLowerCase() === 'about the job' && c.text.length > 'About the job'.length)
          .sort((a, b) => a.text.length - b.text.length);

        const description = candidates[0]?.text.replace(/^About the job\\s*/i, '') || '';
        const applyLink = [...document.querySelectorAll('a[href]')]
          .map(a => ({ href: a.href || '', text: norm(a.textContent || ''), aria: norm(a.getAttribute('aria-label') || '') }))
          .find(a => /apply/i.test(a.text) || /apply/i.test(a.aria));

        return { description, applyUrl: applyLink?.href || '' };
      })()`);
            const description = normalizeWhitespace(detail?.description);
            const apply_url = decodeLinkedinRedirect(String(detail?.applyUrl ?? ''));
            // Empty description after a successful fetch is itself a
            // recognizable signal — surface it via detail_error instead of
            // silently emitting an empty string.
            const detail_error = description ? null : 'missing description';
            enriched.push({
                ...job,
                description: description || null,
                apply_url: apply_url || null,
                detail_error,
            });
        }
        catch (err) {
            if (err instanceof AuthRequiredError)
                throw err;
            const reason = `fetch failed: ${err?.message || err}`;
            console.error(`[opencli:linkedin] Detail fetch failed for ${job.url}: ${reason}`);
            enriched.push({ ...job, description: null, apply_url: null, detail_error: reason });
        }
    }
    return enriched;
}
// ── CLI registration ──────────────────────────────────────────────────
cli({
    site: 'linkedin',
    name: 'search',
    access: 'read',
    description: 'Search LinkedIn jobs',
    domain: 'www.linkedin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Job search keywords' },
        { name: 'location', type: 'string', required: false, help: 'Location text such as San Francisco Bay Area' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of jobs to return (max 100)' },
        { name: 'start', type: 'int', default: 0, help: 'Result offset for pagination' },
        { name: 'details', type: 'bool', default: false, help: 'Include full job description and apply URL (slower)' },
        { name: 'company', type: 'string', required: false, help: 'Comma-separated company names or LinkedIn company IDs' },
        { name: 'experience-level', type: 'string', required: false, help: 'Comma-separated: internship, entry, associate, mid-senior, director, executive' },
        { name: 'job-type', type: 'string', required: false, help: 'Comma-separated: full-time, part-time, contract, temporary, volunteer, internship, other' },
        { name: 'date-posted', type: 'string', required: false, help: 'One of: any, month, week, 24h' },
        { name: 'remote', type: 'string', required: false, help: 'Comma-separated: on-site, hybrid, remote' },
    ],
    columns: ['rank', 'title', 'company', 'location', 'listed', 'salary', 'url'],
    func: async (page, kwargs) => {
        const limit = parseIntegerArg(kwargs.limit, '--limit', 10, MIN_LIMIT, MAX_LIMIT);
        const start = parseIntegerArg(kwargs.start, '--start', 0, MIN_START);
        const includeDetails = Boolean(kwargs.details);
        const location = (kwargs.location ?? '').trim();
        const keywords = String(kwargs.query ?? '').trim();
        if (!keywords)
            throw new ArgumentError('query is required');
        const searchParams = new URLSearchParams({ keywords });
        if (location)
            searchParams.set('location', location);
        await page.goto(`https://www.linkedin.com/jobs/search/?${searchParams.toString()}`);
        await assertLinkedInAuthenticated(page, 'LinkedIn search');
        await page.wait({ text: 'Jobs', timeout: 10 });
        const companyIds = await resolveCompanyIds(page, kwargs.company);
        const input = {
            keywords,
            location,
            limit,
            start,
            companyIds,
            experienceLevels: mapFilterValues(kwargs['experience-level'], EXPERIENCE_LEVELS, 'experience_level'),
            jobTypes: mapFilterValues(kwargs['job-type'], JOB_TYPES, 'job_type'),
            datePostedValues: mapFilterValues(kwargs['date-posted'], DATE_POSTED, 'date_posted'),
            remoteTypes: mapFilterValues(kwargs.remote, REMOTE_TYPES, 'remote'),
        };
        const data = await fetchJobCards(page, input);
        if (!includeDetails)
            return data;
        return enrichJobDetails(page, data);
    },
});

export const __test__ = {
    parseCsvArg,
    parseIntegerArg,
    mapFilterValues,
    decodeLinkedinRedirect,
    looksLinkedInAuthWallText,
    assertLinkedInAuthenticated,
    enrichJobDetails,
    EXPERIENCE_LEVELS,
    JOB_TYPES,
    DATE_POSTED,
    REMOTE_TYPES,
};
