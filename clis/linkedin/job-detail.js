import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  LINKEDIN_DOMAIN,
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeHttpUrl,
  normalizeWhitespace,
  requireLinkedInCookie,
  unwrapEvaluateResult,
} from './shared.js';

// LinkedIn rotates Voyager decoration ids; keep the one we depend on in one place.
// -76 and -80 answer HTTP 400 for jobPostings (#2788).
const JOB_POSTING_DECORATION_ID = 'com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65';

// f_WT codes LinkedIn uses for urn:li:fs_workplaceType:<code>.
const WORKPLACE_TYPE_BY_CODE = { 1: 'On-site', 2: 'Remote', 3: 'Hybrid' };

function parseJobId(value) {
  const url = assertSafeLinkedinUrl(value, 'job-url');
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/jobs\/view\/(\d+)/) || parsed.search.match(/[?&]currentJobId=(\d+)/);
  if (!match) throw new ArgumentError('job-url must be a https://www.linkedin.com/jobs/view/<id> URL');
  return match[1];
}

function normalizeJobUrl(value) {
  return `https://www.linkedin.com/jobs/search/?currentJobId=${parseJobId(value)}`;
}

function buildJobPostingPath(jobId) {
  return `/voyager/api/jobs/jobPostings/${encodeURIComponent(jobId)}?decorationId=${encodeURIComponent(JOB_POSTING_DECORATION_ID)}`;
}

// Runs in-page: fetch one job posting from Voyager with the session csrf token.
// Returns { authRequired } / { error } / { json }.
async function fetchJobPosting(url, csrf) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'csrf-token': csrf,
        accept: 'application/json',
        'x-restli-protocol-version': '2.0.0',
      },
    });
    if (res.status === 401 || res.status === 403) return { authRequired: true, error: 'HTTP ' + res.status };
    if (!res.ok) return { error: 'HTTP ' + res.status };
    const contentType = res.headers?.get?.('content-type') || '';
    if (/\btext\/html\b/i.test(contentType)) {
      return { authRequired: true, error: 'HTML auth/checkpoint response' };
    }
    try {
      return { json: await res.json() };
    } catch {
      return { error: 'response was not valid JSON' };
    }
  } catch (e) {
    return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
  }
}

function firstUnionMember(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.values(value).find((member) => member && typeof member === 'object' && !Array.isArray(member)) || null;
}

function formatListedAt(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

// Maps a Voyager jobPostings payload to a job-detail row. Accepts both the plain
// JSON shape and the normalized `{ data, included }` shape. Returns null when the
// payload carries no title, so the caller can fall back to the rendered page.
function mapJobPosting(json, jobId) {
  if (!json || typeof json !== 'object') return null;
  const root = typeof json.title === 'string' ? json : (json.data && typeof json.data === 'object' ? json.data : null);
  if (!root) return null;
  const title = normalizeWhitespace(typeof root.title === 'string' ? root.title : '');
  if (!title) return null;
  const included = Array.isArray(json.included) ? json.included : [];
  const byUrn = (urn) => (typeof urn === 'string' && urn ? included.find((item) => item && item.entityUrn === urn) : null) || null;

  const companyDetails = firstUnionMember(root.companyDetails);
  const companyEntity = companyDetails?.companyResolutionResult
    || byUrn(companyDetails?.company)
    || byUrn(companyDetails?.['*companyResolutionResult'])
    || null;
  const company = normalizeWhitespace(companyEntity?.name || companyDetails?.companyName || '');
  const companyUrl = typeof companyEntity?.url === 'string' ? companyEntity.url : '';

  const workplaceUrns = Array.isArray(root.workplaceTypes) ? root.workplaceTypes.filter((urn) => typeof urn === 'string') : [];
  const workplaceType = workplaceUrns.map((urn) => normalizeWhitespace(
    root.workplaceTypesResolutionResults?.[urn]?.localizedName
      || byUrn(urn)?.localizedName
      || WORKPLACE_TYPE_BY_CODE[urn.split(':').pop()]
      || '',
  )).filter(Boolean).join(', ');

  const applyMethod = firstUnionMember(root.applyMethod);
  const applyUrl = typeof applyMethod?.companyApplyUrl === 'string' ? applyMethod.companyApplyUrl
    : (typeof applyMethod?.easyApplyUrl === 'string' ? applyMethod.easyApplyUrl : '');

  return {
    url: `https://www.linkedin.com/jobs/view/${jobId}/`,
    title,
    company,
    company_url: companyUrl,
    location: normalizeWhitespace(typeof root.formattedLocation === 'string' ? root.formattedLocation : ''),
    workplace_type: workplaceType,
    job_type: normalizeWhitespace(typeof root.formattedEmploymentStatus === 'string' ? root.formattedEmploymentStatus : ''),
    // The payload's `applies` count reads 0 even when the page shows "Over 100
    // people clicked apply", so the applicant count comes from the rendered page.
    applicants: '',
    listed: formatListedAt(root.listedAt),
    apply_url: applyUrl,
    description: normalizeWhitespace(typeof root.description?.text === 'string' ? root.description.text : ''),
  };
}

function decodeLinkedinRedirect(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/redir/redirect/') return normalizeHttpUrl(parsed.searchParams.get('url') || '');
  } catch {}
  return normalizeHttpUrl(url);
}

function buildExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const readRenderedDescription = () => {
      const expanders = Array.from(document.querySelectorAll('button, a'))
        .filter((el) => /\b(show more|see more|more)\b/i.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
      for (const expander of expanders.slice(0, 3)) {
        try { expander.click(); } catch {}
      }
      const aboutHeading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
        .find((el) => /^about the job$/i.test(clean(el.innerText || el.textContent || '')));
      const aboutRoot = aboutHeading?.closest('section, article, div');
      if (aboutRoot) {
        const value = clean((aboutRoot.innerText || aboutRoot.textContent || '').replace(/^About the job\s*/i, ''));
        if (value && !/^show more$/i.test(value)) return value;
      }
      const candidates = Array.from(document.querySelectorAll(
        '.jobs-description-content__text, .jobs-box__html-content, .jobs-description__content, [class*="jobs-description"], [class*="description-content"]'
      ));
      for (const candidate of candidates) {
        const value = clean(candidate.innerText || candidate.textContent || '');
        if (value && value.length > 40 && !/^show more$/i.test(value)) return value.replace(/^About the job\s*/i, '');
      }
      return '';
    };
    const parseInlineJobData = () => {
      const codes = Array.from(document.querySelectorAll('code[id^="bpr-guid-"]'));
      for (const code of codes) {
        let payload;
        try { payload = JSON.parse(code.textContent || '{}'); } catch { continue; }
        const included = Array.isArray(payload.included) ? payload.included : [];
        const topCard = included.find((item) => item && (item.jobPostingTitle || item.primaryDescription || item.tertiaryDescription));
        if (!topCard) continue;
        const apply = included.find((item) => item && item.companyApplyUrl);
        const workplace = included.find((item) => item && (item.workplaceTypeEnum || item.localizedName));
        const company = included.find((item) => item && item.name && /company/i.test(String(item.entityUrn || item.$type || '')));
        return {
          url: location.href,
          title: clean(topCard.jobPostingTitle || topCard.title?.text || topCard.title?.accessibilityText || ''),
          company: clean(topCard.primaryDescription?.text || company?.name || ''),
          company_url: clean(topCard.primaryDescription?.attributesV2?.[0]?.detailData?.hyperlink || topCard.logo?.actionTarget || ''),
          location: clean(topCard.navigationBarSubtitle || topCard.secondaryDescription?.text || ''),
          workplace_type: clean(workplace?.localizedName || workplace?.workplaceTypeEnum || ''),
          job_type: clean((topCard.jobInsightsV2ResolutionResults || []).flatMap((x) => x?.jobInsightViewModel?.description || []).map((x) => x?.text?.text || '').find((x) => /full-time|part-time|contract|internship/i.test(x)) || ''),
          applicants: clean((topCard.tertiaryDescription?.text || '').match(/Over\s+\d+|\d[\d,]*\s+people clicked apply|\d[\d,]*\s+applicants?/i)?.[0] || ''),
          listed: clean((topCard.tertiaryDescription?.text || '').match(/\d+\s+(?:hour|hours|day|days|week|weeks|month|months)\s+ago/i)?.[0] || ''),
          apply_url: clean(apply?.companyApplyUrl || ''),
          description: '',
        };
      }
      return null;
    };
    const inline = parseInlineJobData();
    const renderedDescription = readRenderedDescription();
    if (inline && inline.title) return { ...inline, description: clean(inline.description || renderedDescription) };
    const text = document.body ? document.body.innerText || '' : '';
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const h1 = clean(document.querySelector('h1')?.innerText || document.querySelector('h1')?.textContent || document.querySelector('.job-details-jobs-unified-top-card__job-title, [class*="job-title"]')?.textContent || '');
    const companyLink = document.querySelector('a[href*="/company/"]');
    const company = clean(companyLink?.innerText || companyLink?.textContent || '');
    const company_url = companyLink?.href ? new URL(companyLink.href, location.origin).toString().replace(/[?#].*$/, '') : '';
    const description = renderedDescription;
    const applyLink = Array.from(document.querySelectorAll('a[href], button')).find((el) => {
      const label = clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      return /\b(apply|easy apply)\b/i.test(label);
    });
    const apply_url = applyLink?.href ? new URL(applyLink.href, location.origin).toString() : '';
    const fullText = lines.join(' ');
    const workplaceMatch = fullText.match(/\b(Remote|Hybrid|On-site|Onsite)\b/i);
    const jobTypeMatch = fullText.match(/\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)\b/i);
    const applicantsMatch = fullText.match(/(?:Over\s+)?\d[\d,]*\s+(?:applicants?|people clicked apply)/i);
    const listedMatch = fullText.match(/(?:Reposted|Posted|Listed)\s+(\d+\s+(?:hour|hours|day|days|week|weeks|month|months)\s+ago)/i);
    const locationLine = lines.find((line) => /\b(Remote|Hybrid|On-site|Onsite)\b/i.test(line) && line.length < 180)
      || lines.find((line) => /,\s*[A-Z][A-Za-z\s]+/.test(line) && line.length < 120)
      || '';
    return {
      url: location.href,
      title: h1,
      company,
      company_url,
      location: locationLine,
      workplace_type: workplaceMatch ? workplaceMatch[1] : '',
      job_type: jobTypeMatch ? jobTypeMatch[1] : '',
      applicants: applicantsMatch ? applicantsMatch[0] : '',
      listed: listedMatch ? listedMatch[1] : '',
      apply_url,
      description,
    };
  })()`;
}

function normalizeDetail(row, apiError = '') {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn job detail returned malformed extraction payload');
  }
  const title = normalizeWhitespace(row.title);
  if (!title) {
    const detail = apiError ? ` (jobPostings API: ${apiError})` : '';
    throw new CommandExecutionError(`LinkedIn job detail could not find a job title${detail}`);
  }
  return {
    title,
    company: normalizeWhitespace(row.company),
    location: normalizeWhitespace(row.location),
    workplace_type: normalizeWhitespace(row.workplace_type),
    job_type: normalizeWhitespace(row.job_type),
    applicants: normalizeWhitespace(row.applicants),
    listed: normalizeWhitespace(row.listed),
    apply_url: decodeLinkedinRedirect(normalizeWhitespace(row.apply_url)),
    company_url: normalizeHttpUrl(row.company_url),
    url: normalizeHttpUrl(row.url),
    description: normalizeWhitespace(row.description),
  };
}

cli({
  site: 'linkedin',
  name: 'job-detail',
  access: 'read',
  description: 'Read one LinkedIn job page with description, apply URL, workplace type, applicants, and company metadata',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'job-url', type: 'string', required: true, positional: true, help: 'Exact LinkedIn job URL, e.g. https://www.linkedin.com/jobs/view/123/' },
  ],
  columns: ['title', 'company', 'location', 'workplace_type', 'job_type', 'applicants', 'listed', 'apply_url', 'company_url', 'url', 'description'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin job-detail');
    const jobId = parseJobId(args['job-url']);
    await page.goto(normalizeJobUrl(args['job-url']));
    await page.wait(4);
    await assertLinkedInAuthenticated(page, 'LinkedIn job-detail');
    const pageRow = unwrapEvaluateResult(await page.evaluate(buildExtractionScript()));

    // SDUI job pages render no <h1> and no inline bpr-guid payload (#2788), so the
    // Voyager job posting is the primary source and the rendered page the fallback.
    const csrf = await requireLinkedInCookie(page, 'LinkedIn job-detail');
    const fetched = unwrapEvaluateResult(
      await page.evaluate(`(${fetchJobPosting.toString()})(${JSON.stringify(buildJobPostingPath(jobId))}, ${JSON.stringify(csrf)})`),
    );
    if (fetched && fetched.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn jobPostings API authentication failed: ' + fetched.error);
    }
    const apiRow = fetched && fetched.json ? mapJobPosting(fetched.json, jobId) : null;
    if (apiRow) {
      const fromPage = pageRow && typeof pageRow === 'object' ? pageRow : {};
      return [normalizeDetail({
        ...apiRow,
        applicants: fromPage.applicants || '',
        apply_url: apiRow.apply_url || fromPage.apply_url || '',
        description: apiRow.description || fromPage.description || '',
      })];
    }
    const apiError = (fetched && fetched.error) || (fetched && fetched.json ? 'payload had no job title' : 'no data');
    return [normalizeDetail(pageRow, apiError)];
  },
});

export const __test__ = {
  parseJobId,
  normalizeJobUrl,
  buildJobPostingPath,
  fetchJobPosting,
  mapJobPosting,
  decodeLinkedinRedirect,
  normalizeDetail,
};
