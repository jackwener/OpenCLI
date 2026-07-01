import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeHttpUrl,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

function normalizeJobUrl(value) {
  const url = assertSafeLinkedinUrl(value, 'job-url');
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/jobs\/view\/(\d+)/) || parsed.search.match(/[?&]currentJobId=(\d+)/);
  if (!match) throw new ArgumentError('job-url must be a https://www.linkedin.com/jobs/view/<id> URL');
  return `https://www.linkedin.com/jobs/search/?currentJobId=${match[1]}`;
}

function normalizePublicJobUrl(value) {
  const url = assertSafeLinkedinUrl(value, 'job-url');
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/jobs\/view\/(?:[^/]+-)?(\d+)/) || parsed.search.match(/[?&]currentJobId=(\d+)/);
  if (!match) throw new ArgumentError('job-url must be a https://www.linkedin.com/jobs/view/<id> URL');
  return `https://www.linkedin.com/jobs/view/${match[1]}`;
}

function decodeLinkedinRedirect(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/redir/redirect/') return normalizeHttpUrl(parsed.searchParams.get('url') || '');
  } catch {}
  return normalizeHttpUrl(url);
}

function stripHtml(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div|section|article|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function trimPublicDescription(value) {
  const text = normalizeWhitespace(value);
  const marker = text.search(/\b(?:We're looking|We are looking|About the role|About The Role|Job description|Job Description|Responsibilities|Qualifications)\b/);
  if (marker > 0 && /use ai|sign in|tailor my resume|email or phone/i.test(text.slice(0, marker))) {
    return normalizeWhitespace(text.slice(marker));
  }
  return text;
}

function extractPublicDescriptionFromHtml(html) {
  const text = String(html || '');
  for (const match of text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const payload = JSON.parse(match[1] || '{}');
      const items = Array.isArray(payload) ? payload : [payload];
      for (const item of items) {
        const description = trimPublicDescription(stripHtml(item?.description || item?.jobDescription || ''));
        if (description.length > 40) return description;
      }
    } catch {}
  }
  const plain = stripHtml(text);
  const reportIndex = plain.search(/\bReport this job\b/i);
  const start = reportIndex >= 0 ? reportIndex + plain.match(/\bReport this job\b/i)[0].length : plain.search(/\b(?:We're looking|About the role|Job description|Responsibilities)\b/i);
  if (start < 0) return '';
  const rest = plain.slice(start);
  const endMatch = rest.search(/\b(?:Show more|Show less|Seniority level|Employment type|Job function|Industries|Similar jobs|People also viewed)\b/i);
  const chunk = trimPublicDescription(rest.slice(0, endMatch > 0 ? endMatch : 5000));
  return chunk.length > 40 ? chunk : '';
}

async function fetchPublicJobDescription(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return '';
    return extractPublicDescriptionFromHtml(await response.text());
  } catch {
    return '';
  }
}

function buildExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const readRenderedDescription = () => {
      const readJsonLd = () => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
          let payload;
          try { payload = JSON.parse(script.textContent || '{}'); } catch { continue; }
          const items = Array.isArray(payload) ? payload : [payload];
          for (const item of items) {
            const value = clean(item?.description || item?.jobDescription || '');
            if (value.length > 40) return value.replace(/<[^>]+>/g, ' ');
          }
        }
        return '';
      };
      const jsonLd = readJsonLd();
      if (jsonLd) return clean(jsonLd);
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
      const lines = (document.body?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
      const reportIndex = lines.findIndex((line) => /^report this job$/i.test(line));
      const startIndex = reportIndex >= 0 ? reportIndex + 1 : lines.findIndex((line) => /^we'?re looking|^about the role|^job description|^responsibilities/i.test(line));
      if (startIndex >= 0) {
        const endIndex = lines.findIndex((line, index) => index > startIndex && /^(show more|show less|seniority level|employment type|job function|industries|similar jobs|people also viewed)$/i.test(line));
        const chunk = lines.slice(startIndex, endIndex > startIndex ? endIndex : startIndex + 80).join(' ');
        if (chunk.length > 40) return chunk;
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
    const applicantsMatch = fullText.match(/(\d[\d,]*)\s+applicants?/i);
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
      applicants: applicantsMatch ? applicantsMatch[1] : '',
      listed: listedMatch ? listedMatch[1] : '',
      apply_url,
      description,
    };
  })()`;
}

function normalizeDetail(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn job detail returned malformed extraction payload');
  }
  const title = normalizeWhitespace(row.title);
  if (!title) throw new CommandExecutionError('LinkedIn job detail could not find a job title');
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
    const publicJobUrl = normalizePublicJobUrl(args['job-url']);
    await page.goto(publicJobUrl);
    await page.wait(4);
    let row = unwrapEvaluateResult(await page.evaluate(buildExtractionScript()));
    let publicDescription = '';
    if (!normalizeWhitespace(row?.description)) {
      publicDescription = await fetchPublicJobDescription(publicJobUrl);
      if (publicDescription) row = { ...row, description: publicDescription };
    }
    if (!normalizeWhitespace(row?.title) || !normalizeWhitespace(row?.description)) {
      const jobUrl = normalizeJobUrl(args['job-url']);
      await page.goto(jobUrl);
      await page.wait(4);
      await assertLinkedInAuthenticated(page, 'LinkedIn job-detail');
      const authenticatedRow = unwrapEvaluateResult(await page.evaluate(buildExtractionScript()));
      row = {
        ...authenticatedRow,
        description: normalizeWhitespace(authenticatedRow?.description) || normalizeWhitespace(row?.description) || publicDescription,
      };
    }
    return [normalizeDetail(row)];
  },
});

export const __test__ = {
  normalizeJobUrl,
  normalizePublicJobUrl,
  decodeLinkedinRedirect,
  extractPublicDescriptionFromHtml,
  normalizeDetail,
};
