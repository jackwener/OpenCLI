import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const WELLFOUND_ORIGIN = 'https://wellfound.com';
export const WELLFOUND_DOMAIN = 'wellfound.com';

export const JOB_COLUMNS = [
  'rank',
  'score',
  'title',
  'company',
  'location',
  'compensation',
  'job_type',
  'posted',
  'recruiter_active',
  'apply_on_wellfound',
  'company_status',
  'company_summary',
  'company_size',
  'company_tags',
  'url',
  'company_url',
];

export const DETAIL_COLUMNS = [
  'title',
  'company',
  'location',
  'compensation',
  'job_type',
  'experience',
  'posted',
  'recruiter_active',
  'remote_policy',
  'company_location',
  'visa_sponsorship',
  'preferred_timezones',
  'collaboration_hours',
  'relocation',
  'company_status',
  'skills',
  'company_size',
  'company_industries',
  'description',
  'url',
  'company_url',
];

export const APPLY_COLUMNS = [
  'status',
  'apply_mode',
  'title',
  'company',
  'message',
  'message_filled',
  'message_length',
  'external_apply_url',
  'url',
  'notes',
];

export const FILTER_COLUMNS = [
  'status',
  'results',
  'role',
  'remote',
  'region',
  'salary',
  'currency',
  'equity',
  'skills',
  'markets',
  'job_types',
  'experience',
  'included_keywords',
  'excluded_keywords',
  'company_size',
  'investment_stage',
  'remote_culture',
  'responsiveness',
  'visa_sponsorship',
  'hide_company_apply',
  'url',
  'notes',
];

export const AI_FULLSTACK_REMOTE_PRESET = {
  skills: ['TypeScript', 'React.js', 'Next.js', 'Node.js'],
  markets: ['Artificial Intelligence', 'Developer Tools', 'SaaS'],
  jobTypes: ['Full Time', 'Contract'],
  includedKeywords: ['AI', 'agentic', 'MCP', 'RAG', 'Gen AI', 'Generative AI', 'Next.js', 'React', 'TypeScript', 'Node.js'],
  excludedKeywords: ['Java, PHP, C#, .NET, Ruby, Scala, AWS Bedrock, unpaid'],
  companySizes: ['1-10 employees', '11-50 employees', '51-200 employees', '201-500 employees'],
  stages: ['Seed Stage', 'Series A', 'Series B', 'Growth'],
  mostlyRemote: true,
  responsive: true,
  visa: false,
  hideCompanyApply: true,
};

export function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

const AI_FOCUS_REGEXP = /\b(ai|artificial intelligence|agentic|agent|rag|mcp|llm|gen\s*ai|generative ai|next\.?js|react\.?js|node\.?js|typescript)\b/i;
const CORE_STACK_REGEXP = /\b(node\.?js|react\.?js|next\.?js|typescript|javascript)\b/i;
const DISALLOWED_STACK_REGEXP = /\b(java|c#|\.net|php|ruby|scala|go|salesforce)\b/i;
const PYTHON_ONLY_EXCLUDE_REGEXP = /\b(python)\b/i;
const KEYWORD_REGEXP = /\b(internship|intern|part[- ]?time|equity only|unpaid)\b/i;
const CLOSED_COMPANY_REGEXP = /\bclosed\b/i;

function toMatchPoolText(row) {
  return normalizeWhitespace(`${row?.title || ''} ${row?.location || ''} ${row?.compensation || ''} ${row?.raw || ''} ${row?.company_summary || ''} ${row?.company || ''} ${row?.company_status || ''}`);
}

function hasPythonOnlySignals(row) {
  const text = toMatchPoolText(row);
  if (!PYTHON_ONLY_EXCLUDE_REGEXP.test(text)) return false;
  return (
    !CORE_STACK_REGEXP.test(text)
    && !AI_FOCUS_REGEXP.test(text)
    && !/\b(front[- ]?end|full[- ]?stack|platform|product|workflow|automation)\b/i.test(text)
  );
}

export function isTopPickHardReject(row) {
  const text = toMatchPoolText(row);
  const hasFitSignals = AI_FOCUS_REGEXP.test(text) || CORE_STACK_REGEXP.test(text);
  if (!hasFitSignals) return true;
  if (DISALLOWED_STACK_REGEXP.test(text)) return true;
  if (KEYWORD_REGEXP.test(text)) return true;
  if (CLOSED_COMPANY_REGEXP.test(normalizeWhitespace(row?.company_status))) return true;
  if (hasPythonOnlySignals(row)) return true;
  return false;
}

export function topPickScoreMultiplier(row) {
  const text = toMatchPoolText(row);
  if (AI_FOCUS_REGEXP.test(text) && CORE_STACK_REGEXP.test(text)) return 1.35;
  if (AI_FOCUS_REGEXP.test(text) || CORE_STACK_REGEXP.test(text)) return 1.15;
  if (/offshore|onsite|onsite only/i.test(text)) return 0.7;
  return 1;
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeWellfoundUrl(value, label = 'url') {
  const raw = normalizeWhitespace(value || `${WELLFOUND_ORIGIN}/jobs`);
  let parsed;
  try {
    parsed = new URL(raw, WELLFOUND_ORIGIN);
  } catch {
    throw new ArgumentError(`${label} must be a Wellfound URL`);
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new ArgumentError(`${label} must be an https Wellfound URL without credentials or port`);
  }
  if (host !== WELLFOUND_DOMAIN && host !== `www.${WELLFOUND_DOMAIN}`) {
    throw new ArgumentError(`${label} must point to wellfound.com`);
  }
  parsed.hostname = WELLFOUND_DOMAIN;
  return parsed.toString();
}

export function parseLimit(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new ArgumentError(`Expected boolean value, got "${value}"`);
}

export function parseListArg(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(normalizeWhitespace).filter(Boolean);
  return String(value).split(',').map(normalizeWhitespace).filter(Boolean);
}

export function normalizeJobSlug(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) throw new ArgumentError('job-url is required');
  if (/^\d+-[a-z0-9-]+$/i.test(raw)) return raw;
  const parsed = new URL(normalizeWellfoundUrl(raw, 'job-url'));
  const fromParam = parsed.searchParams.get('job_listing_slug');
  if (fromParam && /^\d+-[a-z0-9-]+$/i.test(fromParam)) return fromParam;
  const match = parsed.pathname.match(/^\/jobs\/([^/?#]+)/);
  if (match) return match[1];
  throw new ArgumentError('job-url must be a Wellfound /jobs/<id-slug> URL or a job_listing_slug URL');
}

export function buildJobsUrl(args = {}) {
  const base = normalizeWellfoundUrl(args.url || `${WELLFOUND_ORIGIN}/jobs`);
  const parsed = new URL(base);
  if (!parsed.pathname.startsWith('/jobs')) parsed.pathname = '/jobs';
  return parsed.toString();
}

export function buildDetailUrl(slug) {
  return `${WELLFOUND_ORIGIN}/jobs/${normalizeJobSlug(slug)}`;
}

export function normalizeApplyMessage(value) {
  return normalizeMultilineText(value);
}

export function normalizeMultilineText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function looksAuthWall(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return /log in|sign in|join wellfound|continue with google|captcha|verification/i.test(normalized)
    && !/search for jobs|browse all|recommended/i.test(normalized);
}

export async function assertAuthenticated(page, context) {
  const result = unwrapEvaluateResult(await page.evaluate(String.raw`(() => {
    const text = [
      location.href || '',
      document.title || '',
      document.body ? (document.body.innerText || '').slice(0, 3000) : '',
    ].join('\n');
    return {
      text,
      hasJobsNav: /\bBrowse all\b|\bSearch for jobs\b|\bRecommended\b/i.test(text),
      hasSignedInShell: /\bReady to interview\b|\bApplied\b|\bMessages\b|\bDiscover\b|\bProfile\b/i.test(text),
    };
  })()`));
  if (!result || typeof result !== 'object') {
    throw new CommandExecutionError(`${context} returned malformed auth probe payload`);
  }
  if (looksAuthWall(result.text) || (!result.hasJobsNav && !result.hasSignedInShell)) {
    throw new AuthRequiredError(WELLFOUND_DOMAIN, `${context} requires an active signed-in Wellfound browser session.`);
  }
}

export function buildJobsExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const abs = (href) => {
      try { return href ? new URL(href, location.origin).toString() : ''; } catch { return ''; }
    };
    const companyLinks = Array.from(document.querySelectorAll('a[href^="/company/"]'))
      .filter((link) => link.querySelector('h2') || /company logo/i.test(clean(link.textContent || link.getAttribute('aria-label') || '')));
    const companies = [];
    for (const link of companyLinks) {
      const container = link.closest('article, section, li, div') || link.parentElement;
      const heading = container?.querySelector('h2');
      const company = clean(heading?.innerText || heading?.textContent || link.textContent || '');
      if (!company) continue;
      const text = clean(container?.innerText || container?.textContent || '');
      if (companies.some((item) => item.company === company && item.companyUrl === abs(link.getAttribute('href')))) continue;
      const size = (text.match(/\b\d+(?:-\d+|\+)?\s+Employees\b/i) || [''])[0];
      const companyStatus = /\bClosed\b/i.test(text) ? 'closed' : (/Actively Hiring/i.test(text) ? 'actively_hiring' : '');
      const summary = clean(text
        .replace(company, '')
        .replace(/Actively Hiring|Promoted/gi, '')
        .replace(/Closed/gi, '')
        .replace(size, ''));
      companies.push({
        company,
        companyUrl: abs(link.getAttribute('href')),
        companyStatus,
        companySummary: summary,
        companySize: size,
        tags: [],
        y: container?.getBoundingClientRect?.().top ?? 0,
      });
    }
    const jobLinks = Array.from(document.querySelectorAll('a[href^="/jobs/"]'));
    const rows = [];
    for (const link of jobLinks) {
      const href = link.getAttribute('href') || '';
      const slug = href.match(/^\/jobs\/([^/?#]+)/)?.[1] || '';
      if (!/^\d+-/.test(slug)) continue;
      if (!slug || rows.some((row) => row.slug === slug)) continue;
      const text = clean(link.innerText || link.textContent || '');
      if (!text) continue;
      const parts = text.split(/\s+•\s+/).map(clean).filter(Boolean);
      const title = clean(link.querySelector('h1,h2,h3,h4')?.innerText || link.querySelector('h1,h2,h3,h4')?.textContent || parts[0] || '');
      if (!title) continue;
      const posted = (text.match(/(?:Posted|Reposted)\s+(?:today|yesterday|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago)/i) || text.match(/\b(?:today|yesterday|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago)\b/i) || [''])[0];
      const recruiterActive = /Recruiter recently active/i.test(text);
      const locationParts = parts.filter((part) => /remote|onsite|hybrid|india|everywhere|singapore|united states|europe|asia/i.test(part));
      const compensation = parts.find((part) => /[$₹€£]|\b(?:equity|No equity|L|cr|k)\b|%/.test(part)) || '';
      const company = companies.filter((item) => item.y <= (link.getBoundingClientRect?.().top ?? 0) + 5).pop() || companies[companies.length - 1] || {};
      const actionRoot = link.parentElement?.parentElement || link.parentElement;
      rows.push({
        slug,
        title,
        location: locationParts.join(' • '),
        compensation,
        posted,
        recruiter_active: recruiterActive,
        apply_on_wellfound: /Apply on Wellfound/i.test(clean(actionRoot?.innerText || actionRoot?.textContent || '')),
        company: company.company || '',
        company_status: company.companyStatus || '',
        company_summary: company.companySummary || '',
        company_size: company.companySize || '',
        company_tags: Array.isArray(company.tags) ? company.tags.join('; ') : '',
        url: abs(href),
        company_url: company.companyUrl || '',
        raw: text,
      });
    }
    const resultHeading = clean(Array.from(document.querySelectorAll('h1,h2,h3,h4')).map((h) => h.innerText || h.textContent || '').find((s) => /\d+\s+results/i.test(s)) || '');
    return { result_heading: resultHeading, rows };
  })()`;
}

export function normalizeJobRows(payload, limit, context = 'wellfound jobs') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new CommandExecutionError(`${context} returned malformed extraction payload`);
  }
  const rows = payload.rows.map((row, index) => normalizeJobRow(row, index + 1)).filter((row) => row.title && row.url);
  if (rows.length === 0) throw new EmptyResultError(context, 'No Wellfound job cards were visible in the current search');
  return rows.slice(0, limit);
}

export function normalizeJobRow(row, rank = 1) {
  const rawText = normalizeWhitespace(row?.raw || row?.title);
  const title = cleanJobTitle(row?.title || rawText);
  const company = normalizeWhitespace(row?.company);
  const location = normalizeWhitespace(extractLocation(row?.location) || extractLocation(rawText));
  const compensation = normalizeWhitespace(extractCompensation(row?.compensation) || extractCompensation(rawText));
  const posted = normalizeWhitespace(row?.posted);
  const recruiterActive = Boolean(row?.recruiter_active);
  const applyOnWellfound = Boolean(row?.apply_on_wellfound);
  return {
    rank,
    score: scoreJob({ ...row, title, company, location, compensation, posted, recruiter_active: recruiterActive, apply_on_wellfound: applyOnWellfound }),
    title,
    company,
    location,
    compensation,
    job_type: inferJobType(`${title} ${location} ${row?.raw || ''}`),
    posted,
    recruiter_active: recruiterActive ? 'yes' : 'no',
    apply_on_wellfound: applyOnWellfound ? 'yes' : 'no',
    company_status: normalizeCompanyStatus(row?.company_status),
    company_summary: normalizeWhitespace(row?.company_summary),
    company_size: normalizeWhitespace(row?.company_size),
    company_tags: normalizeWhitespace(row?.company_tags),
    url: normalizeWellfoundUrl(row?.url || `/jobs/${row?.slug || ''}`),
    company_url: row?.company_url ? normalizeWellfoundUrl(row.company_url, 'company_url') : '',
  };
}

export function cleanJobTitle(text) {
  const raw = normalizeWhitespace(text);
  if (!raw) return '';
  return normalizeWhitespace(raw
    .replace(/\b(?:Remote only|Remote|Onsite or remote|Onsite|Hybrid)\b.*$/i, '')
    .replace(/\s+[$₹€£].*$/i, '')
    .replace(/\s+\d+(?:\.\d+)?%\s*[–-].*$/i, ''));
}

export function inferJobType(text) {
  const normalized = normalizeWhitespace(text);
  if (/\bcontract\b/i.test(normalized)) return 'Contract';
  if (/\bfreelance\b/i.test(normalized)) return 'Freelance';
  if (/\bpart[- ]?time\b/i.test(normalized)) return 'Part Time';
  if (/\bintern(?:ship)?\b/i.test(normalized)) return 'Internship';
  if (/\bco[- ]?founder\b/i.test(normalized)) return 'Cofounder';
  if (/\bfull[- ]?time\b/i.test(normalized)) return 'Full Time';
  return '';
}

export function extractLocation(text) {
  const raw = normalizeWhitespace(text);
  const match = raw.match(/\b(?:Remote only|Remote|Onsite or remote|Onsite|Hybrid)\b(?:\s*•?\s*(?:Remote\s*\([^)]*\)|[A-Z][A-Za-z\s,]+|India|Everywhere|Singapore|United States|Europe|Asia))?/i);
  if (!match) return '';
  return normalizeWhitespace(match[0].replace(/(only|remote)(India|Everywhere|Singapore|United States|Europe|Asia)/i, '$1 • $2'));
}

export function extractCompensation(text) {
  const raw = normalizeWhitespace(text);
  const match = raw.match(/(?:[$₹€£]\s?[\d,.]+\s*(?:k|K|L|cr|m|M)?(?:\s*[–-]\s*[$₹€£]?[\d,.]+\s*(?:k|K|L|cr|m|M)?)?(?:\s*•\s*(?:No equity|[\d.]+%\s*[–-]\s*[\d.]+%))?|(?:No equity|[\d.]+%\s*[–-]\s*[\d.]+%))/);
  return match ? normalizeWhitespace(match[0]) : '';
}

export function scoreJob(row) {
  const text = `${row.title || ''} ${row.location || ''} ${row.compensation || ''} ${row.posted || ''} ${row.raw || ''}`;
  let score = 0;
  if (/remote only/i.test(text)) score += 25;
  else if (/remote/i.test(text)) score += 15;
  if (/today|yesterday/i.test(text)) score += 20;
  else if (/\b\d+\s+days?\s+ago\b/i.test(text)) score += 10;
  if (row.recruiter_active) score += 15;
  if (row.apply_on_wellfound) score += 10;
  if (/\b(ai|agent|full[- ]?stack|platform|founding|product engineer|react|node)\b/i.test(text)) score += 15;
  if (/\bcontract|freelance|part[- ]?time\b/i.test(text)) score += 8;
  if (/₹\s*(?:[3-9]\d|[1-9]\d{2})L|₹.*cr|\$\s*(?:[6-9]\d|[1-9]\d{2})k/i.test(text)) score += 12;
  if (/\bintern(?:ship)?\b/i.test(text)) score -= 35;
  if (/unpaid|equity only/i.test(text)) score -= 35;
  if (/₹\s*\d{1,2},\d{3}\b/i.test(text)) score -= 25;
  if (/₹\s*(?:[1-9](?:\.\d+)?L|1\d(?:\.\d+)?L|2\d(?:\.\d+)?L)(?:\s*[–-]\s*₹?\s*(?:[1-9](?:\.\d+)?L|1\d(?:\.\d+)?L|2\d(?:\.\d+)?L))?\b/i.test(text) && !/₹\s*(?:3\d|[4-9]\d|[1-9]\d{2})L|₹.*cr/i.test(text)) score -= 18;
  if (/₹\s*[1-9](?:\.\d+)?L\s*[–-]\s*₹?\s*[1-9](?:\.\d+)?L/i.test(text)) score -= 30;
  if (/\$\s*(?:[1-2]?\d)k\s*[–-]\s*\$?\s*(?:[1-2]?\d)k/i.test(text)) score -= 18;
  if (/\b(Java|PHP|C#|C\+\+|Ruby|Scala|\.NET|AWS Bedrock|Django)\b/i.test(text)) score -= 20;
  return score;
}

export function normalizeCompanyStatus(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return '';
  if (/\bclosed\b/.test(normalized)) return 'closed';
  if (/\bactively[_ -]?hiring\b/.test(normalized)) return 'actively_hiring';
  return normalized;
}

export function buildDetailExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const abs = (href) => {
      try { return href ? new URL(href, location.origin).toString() : ''; } catch { return ''; }
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const jobDialog = dialogs.reverse().find((node) => {
      const content = clean(node.innerText || node.textContent || '');
      return node.querySelector('h1') && /\bApply\b|\bAbout the job\b|\bRemote work policy\b/i.test(content);
    });
    const dialog = jobDialog || document.body;
    const jobDetail = dialog.querySelector('[data-test="JobDetail"]') || document.querySelector('[data-test="JobDetail"]') || dialog;
    const text = clean(dialog?.innerText || dialog?.textContent || '');
    const title = clean(jobDetail?.querySelector('h1')?.innerText || jobDetail?.querySelector('h1')?.textContent || dialog?.querySelector('h1')?.innerText || dialog?.querySelector('h1')?.textContent || '').replace(/\s+at\s+.+$/i, '');
    const companyLink = Array.from(dialog?.querySelectorAll('a[href^="/company/"]') || []).find((a) => clean(a.innerText || a.textContent || '').length > 1);
    const company = clean(companyLink?.innerText || companyLink?.textContent || '');
    const companyUrl = abs(companyLink?.getAttribute('href') || '');
    const detailsList = clean(jobDetail?.querySelector('h1')?.parentElement?.innerText || dialog?.querySelector('h1')?.nextElementSibling?.innerText || '');
    const fieldAfter = (label) => {
      const dt = Array.from(dialog.querySelectorAll('dt')).find((node) => new RegExp('^' + label + '$', 'i').test(clean(node.innerText || node.textContent || '')));
      const dd = dt?.parentElement?.querySelector('dd');
      if (dd) return clean(dd.innerText || dd.textContent || '');
      const pattern = new RegExp(label + '\\\\s+([^\\\\n]+)', 'i');
      return clean((text.match(pattern) || [])[1] || '');
    };
    const aboutHeading = Array.from(dialog?.querySelectorAll('h2') || []).find((h) => /^About the job$/i.test(clean(h.innerText || h.textContent || '')));
    const descriptionParts = [];
    let node = aboutHeading?.nextElementSibling;
    while (node) {
      const heading = /^H[1-4]$/.test(node.tagName || '') ? clean(node.innerText || node.textContent || '') : '';
      if (/^About the company$/i.test(heading)) break;
      const value = clean(node.innerText || node.textContent || '');
      if (value) descriptionParts.push(value);
      node = node.nextElementSibling;
    }
    if (!descriptionParts.length && jobDetail) {
      descriptionParts.push(clean(jobDetail.innerText || jobDetail.textContent || ''));
    }
    const skillStart = text.indexOf('Skills ');
    const aboutStart = text.indexOf('About the job');
    const skillsText = skillStart >= 0 && aboutStart > skillStart
      ? text.slice(skillStart + 7, aboutStart)
      : clean(Array.from(dialog.querySelectorAll('dt')).find((node) => /^Skills$/i.test(clean(node.innerText || node.textContent || '')))?.parentElement?.querySelector('dd')?.innerText || '');
    const industryLinks = Array.from(dialog?.querySelectorAll('a[href*="/startups/industry/"]') || []).map((a) => clean(a.innerText || a.textContent || '')).filter(Boolean);
    const size = clean((text.match(/\b\d+(?:-\d+|\+)?\s+Employees\b/i) || text.match(/Company Size\s+(\d+(?:-\d+|\+)?)/i) || [''])[0]).replace(/^Company Size\s+/i, '');
    const companyHeaderText = clean((dialog?.querySelector('[data-testid="startup-header"]') || dialog?.querySelector('section'))?.innerText || '');
    const statusText = companyHeaderText || text.slice(0, 1200);
    return {
      title,
      company,
      company_url: companyUrl,
      details: detailsList,
      text,
      compensation: (detailsList.match(/[$₹€£]\s*[\d,.]+\s*(?:k|K|L|cr|m|M)?\s*[–-]\s*[$₹€£]?\s*[\d,.]+\s*(?:k|K|L|cr|m|M)?(?:\s*•\s*(?:No equity|[\d.]+%\s*[–-]\s*[\d.]+%))?|No equity|[\d.]+%\s*[–-]\s*[\d.]+%/) || text.match(/[$₹€£]\s*[\d,.]+\s*(?:k|K|L|cr|m|M)?\s*[–-]\s*[$₹€£]?\s*[\d,.]+\s*(?:k|K|L|cr|m|M)?(?:\s*•\s*(?:No equity|[\d.]+%\s*[–-]\s*[\d.]+%))?/) || [''])[0],
      location: (detailsList.match(/Remote[^|]+|Onsite[^|]+|Hybrid[^|]+/) || (fieldAfter('Hires remotely') ? ['Remote (' + fieldAfter('Hires remotely') + ')'] : ['']))[0],
      experience: (detailsList.match(/\d+\s+years?\s+of\s+exp/i) || text.match(/\d+\s*\+?\s+years?/i) || [''])[0],
      job_type: (detailsList.match(/\bFull Time|Part Time|Contract|Internship|Cofounder|Freelance\b/i) || text.match(/\bFull Time|Part Time|Contract|Internship|Cofounder|Freelance\b/i) || [''])[0],
      posted: (text.match(/Reposted:\s*[^•]+|Posted\s+(?:today|yesterday|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago)/i) || [''])[0],
      recruiter_active: /Recruiter recently active/i.test(text),
      remote_policy: fieldAfter('Remote Work Policy'),
      company_location: fieldAfter('Company Location'),
      visa_sponsorship: fieldAfter('Visa Sponsorship'),
      preferred_timezones: fieldAfter('Preferred Timezones'),
      collaboration_hours: fieldAfter('Collaboration Hours'),
      relocation: fieldAfter('Relocation'),
      company_status: /\bClosed\b/i.test(statusText) ? 'closed' : (/Actively Hiring/i.test(statusText) ? 'actively_hiring' : ''),
      skills: skillsText,
      company_size: size,
      company_industries: Array.from(new Set(industryLinks)).join('; '),
      description: descriptionParts.join('\\n\\n'),
      url: location.href,
    };
  })()`;
}

export function normalizeDetailRow(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('wellfound job-detail returned malformed extraction payload');
  }
  const title = normalizeWhitespace(row.title);
  if (!title) throw new CommandExecutionError('wellfound job-detail could not find a job title');
  return {
    title,
    company: normalizeWhitespace(row.company),
    location: normalizeWhitespace(row.location || extractLocation(row.details)),
    compensation: normalizeWhitespace(row.compensation || extractCompensation(row.details)),
    job_type: normalizeWhitespace(row.job_type || inferJobType(row.details)),
    experience: normalizeWhitespace(row.experience),
    posted: normalizeWhitespace(row.posted).replace(/^Reposted:\s*/i, 'Reposted '),
    recruiter_active: row.recruiter_active ? 'yes' : 'no',
    remote_policy: normalizeWhitespace(row.remote_policy),
    company_location: normalizeWhitespace(row.company_location),
    visa_sponsorship: normalizeWhitespace(row.visa_sponsorship),
    preferred_timezones: normalizeWhitespace(row.preferred_timezones),
    collaboration_hours: normalizeWhitespace(row.collaboration_hours),
    relocation: normalizeWhitespace(row.relocation),
    company_status: normalizeCompanyStatus(row.company_status),
    skills: normalizeWhitespace(row.skills).replace(/\s+/g, '; '),
    company_size: normalizeWhitespace(row.company_size),
    company_industries: normalizeWhitespace(row.company_industries),
    description: normalizeWhitespace(row.description),
    url: normalizeWellfoundUrl(row.url || WELLFOUND_ORIGIN),
    company_url: row.company_url ? normalizeWellfoundUrl(row.company_url, 'company_url') : '',
  };
}

export function normalizeApplyState(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('wellfound apply returned malformed extraction payload');
  }
  const title = normalizeWhitespace(row.title);
  const company = normalizeWhitespace(row.company);
  const externalApplyUrl = row.external_apply_url ? normalizeWellfoundOrHttpUrl(row.external_apply_url) : '';
  let applyMode = normalizeWhitespace(row.apply_mode).toLowerCase();
  if (!applyMode) {
    applyMode = externalApplyUrl ? 'company_website' : row.can_apply_on_wellfound ? 'wellfound' : 'unknown';
  }
  return {
    status: normalizeWhitespace(row.status || 'ready'),
    apply_mode: applyMode,
    title,
    company,
    message: normalizeMultilineText(row.message),
    message_filled: normalizeWhitespace(row.message_filled),
    message_length: row.message_length === undefined || row.message_length === null ? '' : String(row.message_length),
    external_apply_url: externalApplyUrl,
    url: normalizeWellfoundUrl(row.url || WELLFOUND_ORIGIN),
    notes: normalizeWhitespace(row.notes),
  };
}

export function normalizeWellfoundOrHttpUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, WELLFOUND_ORIGIN);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function assertExpectedApplyTarget(state, expectedTitle, expectedCompany) {
  const title = normalizeWhitespace(expectedTitle);
  const company = normalizeWhitespace(expectedCompany);
  if (title && state.title !== title) {
    throw new ArgumentError(`Refusing to apply: expected title "${title}" but found "${state.title}"`);
  }
  if (company && state.company !== company) {
    throw new ArgumentError(`Refusing to apply: expected company "${company}" but found "${state.company}"`);
  }
}

export function buildApplyInspectionScript(message = '') {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const abs = (href) => {
      try { return href ? new URL(href, location.origin).toString() : ''; } catch { return ''; }
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const jobDialog = dialogs.reverse().find((node) => {
      const content = clean(node.innerText || node.textContent || '');
      return node.querySelector('h1') && /\bApply\b|\bAbout the job\b|\bRemote work policy\b/i.test(content);
    });
    const dialog = jobDialog || document.body;
    const jobDetail = dialog.querySelector('[data-test="JobDetail"]') || document.querySelector('[data-test="JobDetail"]') || dialog;
    const text = clean(dialog.innerText || dialog.textContent || '');
    const title = clean(jobDetail.querySelector('h1')?.innerText || jobDetail.querySelector('h1')?.textContent || dialog.querySelector('h1')?.innerText || dialog.querySelector('h1')?.textContent || '').replace(/\s+at\s+.+$/i, '');
    const companyLink = Array.from(dialog.querySelectorAll('a[href^="/company/"]')).find((a) => clean(a.innerText || a.textContent || '').length > 1);
    const company = clean(companyLink?.innerText || companyLink?.textContent || '');
    const textarea = Array.from(dialog.querySelectorAll('textarea')).find((el) => /interest|working|company|message/i.test(clean(el.placeholder || el.getAttribute('aria-label') || '') + ' ' + text)) || dialog.querySelector('textarea');
    const applyButton = Array.from(dialog.querySelectorAll('button')).find((btn) => /^Apply$/i.test(clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '')));
    const externalLink = Array.from(dialog.querySelectorAll('a[href]')).find((a) => {
      const label = clean(a.innerText || a.textContent || a.getAttribute('aria-label') || '');
      const href = abs(a.getAttribute('href') || '');
      return /\bapply\b/i.test(label) && href && !href.startsWith('https://wellfound.com/');
    });
    const alreadyApplied = /\b(applied|application submitted|application sent)\b/i.test(text) && !applyButton;
    let applyMode = 'unknown';
    if (textarea || applyButton || /Apply to/i.test(text)) applyMode = 'wellfound';
    if (externalLink) applyMode = 'company_website';
    if (alreadyApplied) applyMode = 'already_applied';
    return {
      status: alreadyApplied ? 'already_applied' : 'ready',
      apply_mode: applyMode,
      can_apply_on_wellfound: Boolean(applyButton),
      has_message_box: Boolean(textarea),
      title,
      company,
      message: ${JSON.stringify(message)},
      external_apply_url: externalLink ? abs(externalLink.getAttribute('href') || '') : '',
      url: location.href,
      notes: alreadyApplied ? 'Already applied or submitted state detected' : (applyMode === 'company_website' ? 'This job appears to require applying on the company website' : ''),
    };
  })()`;
}

export function buildApplySubmitScript(message) {
  return String.raw`(async () => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const jobRoot = () => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const jobDialog = dialogs.reverse().find((node) => {
        const content = clean(node.innerText || node.textContent || '');
        return node.querySelector('h1') && /\bApply\b|\bAbout the job\b|\bRemote work policy\b/i.test(content);
      });
      return jobDialog || document.querySelector('[data-test="JobDetail"]') || document.body;
    };
    const findTextarea = (root) => {
      const text = clean(root.innerText || root.textContent || '');
      return Array.from(root.querySelectorAll('textarea')).find((el) => /interest|working|company|message|question|answer/i.test(clean(el.placeholder || el.getAttribute('aria-label') || el.name || '') + ' ' + text)) || root.querySelector('textarea');
    };
    const findButton = (root, pattern) => Array.from(root.querySelectorAll('button')).find((btn) => pattern.test(clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '')));
    let root = jobRoot();
    let textarea = findTextarea(root);
    if (!textarea) {
      const revealButton = findButton(root, /^(Apply|Apply now)$/i) || findButton(document.body, /^(Apply|Apply now)$/i);
      if (revealButton && !revealButton.disabled && revealButton.getAttribute('aria-disabled') !== 'true') {
        revealButton.click();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        root = jobRoot();
        textarea = findTextarea(root);
      }
    }
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter ? setter.call(textarea, ${JSON.stringify(message)}) : textarea.value = ${JSON.stringify(message)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const filledValue = textarea ? textarea.value : '';
    const messageFilled = Boolean(textarea) && filledValue === ${JSON.stringify(message)};
    const submitButton = findButton(root, /^(Send application|Submit application)$/i)
      || findButton(document.body, /^(Send application|Submit application)$/i)
      || findButton(root, /^(Apply now|Apply)$/i)
      || findButton(document.body, /^(Apply now|Apply)$/i);
    if (!submitButton) {
      return { clicked: false, status: 'not_submitted', message_filled: messageFilled ? 'yes' : 'no', message_length: filledValue.length, notes: 'Application submit button not found' };
    }
    if (submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true') {
      return { clicked: false, status: 'not_submitted', message_filled: messageFilled ? 'yes' : 'no', message_length: filledValue.length, notes: 'Application submit button is disabled' };
    }
    submitButton.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const afterText = clean((Array.from(document.querySelectorAll('[role="dialog"]')).pop() || document.body).innerText || document.body.textContent || '');
    const submitted = /\b(application submitted|application sent|applied|you applied)\b/i.test(afterText);
    return {
      clicked: true,
      status: submitted ? 'submitted' : 'clicked',
      message_filled: messageFilled ? 'yes' : 'no',
      message_length: filledValue.length,
      notes: submitted ? 'Wellfound reported an applied/submitted state' : 'Clicked application submit; no explicit success text was detected',
    };
  })()`;
}

export function normalizeFilterState(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('wellfound filters returned malformed extraction payload');
  }
  return {
    status: normalizeWhitespace(row.status || 'read'),
    results: normalizeWhitespace(row.results),
    role: normalizeWhitespace(row.role),
    remote: normalizeWhitespace(row.remote),
    region: normalizeWhitespace(row.region),
    salary: normalizeWhitespace(row.salary),
    currency: normalizeWhitespace(row.currency),
    equity: normalizeWhitespace(row.equity),
    skills: normalizeList(row.skills),
    markets: normalizeList(row.markets),
    job_types: normalizeList(row.job_types),
    experience: normalizeWhitespace(row.experience),
    included_keywords: normalizeWhitespace(row.included_keywords),
    excluded_keywords: normalizeWhitespace(row.excluded_keywords),
    company_size: normalizeList(row.company_size),
    investment_stage: normalizeList(row.investment_stage),
    remote_culture: normalizeWhitespace(row.remote_culture),
    responsiveness: normalizeWhitespace(row.responsiveness),
    visa_sponsorship: normalizeWhitespace(row.visa_sponsorship),
    hide_company_apply: normalizeWhitespace(row.hide_company_apply),
    url: normalizeWellfoundUrl(row.url || WELLFOUND_ORIGIN),
    notes: normalizeWhitespace(row.notes),
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(normalizeWhitespace).filter(Boolean).join('; ');
  return normalizeWhitespace(value);
}

export function buildFilterConfig(args = {}) {
  const preset = normalizeWhitespace(args.preset);
  if (preset && preset !== 'ai-fullstack-remote') {
    throw new ArgumentError(`Unknown wellfound filters preset "${preset}"`);
  }
  const usePreset = preset === 'ai-fullstack-remote';
  const base = usePreset ? AI_FULLSTACK_REMOTE_PRESET : {};
  return {
    salaryMin: normalizeWhitespace(args['salary-min']),
    salaryMax: normalizeWhitespace(args['salary-max']),
    currency: normalizeWhitespace(args.currency),
    equityMin: normalizeWhitespace(args['equity-min']),
    equityMax: normalizeWhitespace(args['equity-max']),
    skills: parseListArg(args.skills ?? base.skills),
    markets: parseListArg(args.markets ?? base.markets),
    jobTypes: parseListArg(args['job-types'] ?? base.jobTypes),
    includedKeywords: parseListArg(args['include-keywords'] ?? base.includedKeywords),
    excludedKeywords: parseListArg(args['exclude-keywords'] ?? base.excludedKeywords),
    companySizes: parseListArg(args['company-sizes'] ?? base.companySizes),
    stages: parseListArg(args.stages ?? base.stages),
    mostlyRemote: args['mostly-remote'] !== undefined ? parseBoolean(args['mostly-remote']) : base.mostlyRemote,
    responsive: args.responsive !== undefined ? parseBoolean(args.responsive) : base.responsive,
    visa: args.visa !== undefined ? parseBoolean(args.visa) : base.visa,
    hideCompanyApply: args['hide-company-apply'] !== undefined ? parseBoolean(args['hide-company-apply']) : base.hideCompanyApply,
    usePreset,
  };
}

export function buildFilterInspectionScript(status = 'read', notes = '') {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const body = clean(document.body?.innerText || document.body?.textContent || '');
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    const root = dialog || document.body;
    const text = clean(root.innerText || root.textContent || '');
    const checkboxLabel = (input) => {
      let node = input;
      for (let i = 0; node && i < 4; i += 1, node = node.parentElement) {
        const text = clean(node.innerText || node.textContent || '');
        if (text && text !== clean(input.value || '')) return text;
      }
      return clean(input.getAttribute('aria-label') || input.id || input.value || '');
    };
    const checkedLabels = Array.from(root.querySelectorAll('input[type="checkbox"]'))
      .filter((input) => input.checked)
      .map(checkboxLabel);
    const resultHeading = clean(Array.from(document.querySelectorAll('h1,h2,h3,h4')).map((h) => h.innerText || h.textContent || '').find((s) => /\d+\s+results/i.test(s)) || '');
    const topButtons = Array.from(document.querySelectorAll('button')).map((b) => clean(b.innerText || b.textContent || '')).filter(Boolean).slice(0, 20);
    const role = topButtons.find((value) => /engineer|developer|designer|manager|ai|full-stack|frontend|backend/i.test(value)) || '';
    const remote = topButtons.find((value) => /remote/i.test(value)) || '';
    const region = topButtons.find((value) => /asia|india|europe|united states|everywhere/i.test(value)) || '';
    const valuesByHeading = (heading) => {
      const start = text.search(new RegExp(heading, 'i'));
      if (start < 0) return '';
      return text.slice(start, start + 700);
    };
    return {
      status: ${JSON.stringify(status)},
      results: resultHeading,
      role,
      remote,
      region,
      salary: clean((valuesByHeading('Salary').match(/(?:Any salary|[$₹€£]?\\d[^\\n]{0,80})/) || [''])[0]),
      currency: clean((valuesByHeading('Salary').match(/All currencies|USD|INR|EUR|GBP|CAD|AUD/i) || [''])[0]),
      equity: clean((valuesByHeading('Equity').match(/\\d+(?:\\.\\d+)?%\\s*-\\s*(?:\\d+(?:\\.\\d+)?%|2%\\+)/) || [''])[0]),
      skills: checkedLabels.filter((x) => /Python|React|Node|Java|Ruby|TypeScript|Next|AI|LLM|MCP|RAG/i.test(x)),
      markets: checkedLabels.filter((x) => /Healthcare|E-Commerce|Education|Enterprise|Marketplaces|Artificial|Developer|SaaS/i.test(x)),
      job_types: checkedLabels.filter((x) => /Full Time|Contract|Internship|Cofounder/i.test(x)),
      experience: clean(valuesByHeading('Required experience').match(/\\d+\\s*-\\s*\\d+|\\d+\\+?|Any/i)?.[0] || ''),
      included_keywords: '',
      excluded_keywords: '',
      company_size: checkedLabels.filter((x) => /employees/i.test(x)),
      investment_stage: checkedLabels.filter((x) => /Seed Stage|Series A|Series B|Growth|IPO|Acquired/i.test(x)),
      remote_culture: checkedLabels.some((x) => /mostly or fully remote/i.test(x)) ? 'yes' : 'no',
      responsiveness: checkedLabels.some((x) => /highly responsive/i.test(x)) ? 'yes' : 'no',
      visa_sponsorship: checkedLabels.some((x) => /sponsor a visa/i.test(x)) ? 'yes' : 'no',
      hide_company_apply: /Hide jobs which require me to apply on the company's website/i.test(body) ? 'visible' : 'unknown',
      url: location.href,
      notes: ${JSON.stringify(notes)},
    };
  })()`;
}

export function buildOpenFiltersScript() {
  return String.raw`(async () => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const isFilterDialog = () => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
      const text = clean(dialog?.innerText || dialog?.textContent || '');
      return /Compensation/.test(text) && /Job Types/.test(text) && /View results/.test(text);
    };
    if (isFilterDialog()) return { opened: true };
    const existingDialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    if (existingDialog) {
      const close = Array.from(existingDialog.querySelectorAll('button')).find((btn) => {
        const text = clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '');
        return /close|back|×/i.test(text) || !text;
      });
      if (close) close.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const button = Array.from(document.querySelectorAll('button')).find((btn) => /^Filters$/i.test(clean(btn.innerText || btn.textContent || '')));
    if (!button) return { opened: false, reason: 'Filters button not found' };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { opened: isFilterDialog() };
  })()`;
}

export function buildFilterUpdateScript(config) {
  return String.raw`(async () => {
    const config = ${JSON.stringify(config)};
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    if (!dialog) return { ok: false, notes: 'Filters dialog is not open', unsupported: [] };
    const unsupported = [];
    const setValue = (el, value) => {
      if (!el || value === undefined || value === null || value === '') return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, String(value)) : el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const inputs = Array.from(dialog.querySelectorAll('input'));
    const spin = inputs.filter((el) => el.getAttribute('role') === 'spinbutton' || el.type === 'number' || el.inputMode === 'numeric');
    setValue(spin[0], config.salaryMin);
    setValue(spin[1], config.salaryMax);
    const textInputs = inputs.filter((el) => !['checkbox', 'radio', 'range', 'number'].includes(el.type));
    if (config.currency) setValue(textInputs.find((el) => /currenc/i.test(clean(el.placeholder || el.getAttribute('aria-label') || ''))) || textInputs[0], config.currency);
    const checkboxLabel = (input) => {
      let node = input;
      for (let i = 0; node && i < 4; i += 1, node = node.parentElement) {
        const text = clean(node.innerText || node.textContent || '');
        if (text && text !== clean(input.value || '')) return text;
      }
      return clean(input.getAttribute('aria-label') || input.id || input.value || '');
    };
    const clickCheckbox = (labelText, checked) => {
      if (checked === undefined) return;
      const expected = String(labelText).toLowerCase();
      const input = Array.from(dialog.querySelectorAll('input[type="checkbox"]')).find((node) => {
        const label = checkboxLabel(node).toLowerCase();
        return label === expected || label.includes(expected);
      });
      if (!input) { unsupported.push(labelText); return; }
      if (input.checked !== checked) input.click();
    };
    for (const value of config.jobTypes || []) clickCheckbox(value, true);
    for (const value of config.companySizes || []) clickCheckbox(value, true);
    for (const value of config.stages || []) clickCheckbox(value, true);
    clickCheckbox('Only show jobs at companies that are mostly or fully remote', config.mostlyRemote);
    clickCheckbox('Only show companies highly responsive to incoming applications', config.responsive);
    clickCheckbox('Only show companies that can sponsor a visa', config.visa);
    const keywordInputs = Array.from(dialog.querySelectorAll('input[placeholder="Enter a keyword"]'));
    if (config.includedKeywords?.length && keywordInputs[0]) setValue(keywordInputs[0], config.includedKeywords.join(', '));
    if (config.excludedKeywords?.length && keywordInputs[1]) setValue(keywordInputs[1], config.excludedKeywords.join(', '));
    if ((config.skills || []).length) unsupported.push('skills autocomplete requires visible UI selection');
    if ((config.markets || []).length) unsupported.push('markets autocomplete requires visible UI selection');
    const viewResults = Array.from(dialog.querySelectorAll('button')).find((btn) => /^View results$/i.test(clean(btn.innerText || btn.textContent || '')));
    if (viewResults && !viewResults.disabled) {
      viewResults.click();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return { ok: true, unsupported };
  })()`;
}
