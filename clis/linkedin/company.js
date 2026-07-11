import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    LINKEDIN_DOMAIN,
    assertLinkedInAuthenticated,
    normalizeWhitespace,
    unwrapEvaluateResult,
} from './shared.js';

const SLUG_RE = /^[A-Za-z0-9%._-]+$/;
const COMPANY_URL_RE = /^\/company\/([^/?#]+)/;
const LINKEDIN_COMPANY_HOSTS = new Set(['linkedin.com', LINKEDIN_DOMAIN]);

// Accept a bare universal name (`nvidia`), a `/company/<slug>` path, or a full
// company URL, and return the canonical about-page URL.
function normalizeCompanyUrl(value) {
    const raw = normalizeWhitespace(value || '');
    if (!raw) {
        throw new CommandExecutionError('LinkedIn company requires a company universal name or URL');
    }
    let slug = raw;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/company/')) {
        let parsed;
        try {
            parsed = raw.startsWith('/') ? new URL(raw, `https://${LINKEDIN_DOMAIN}`) : new URL(raw);
        } catch {
            throw new CommandExecutionError(`LinkedIn company received a malformed URL: ${raw}`);
        }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !LINKEDIN_COMPANY_HOSTS.has(parsed.hostname.toLowerCase())) {
            throw new CommandExecutionError('LinkedIn company URL must point to linkedin.com');
        }
        const m = parsed.pathname.match(COMPANY_URL_RE);
        if (!m) throw new CommandExecutionError('LinkedIn company URL must look like /company/<name>');
        try {
            slug = decodeURIComponent(m[1]);
        } catch {
            throw new CommandExecutionError(`LinkedIn company URL has a malformed company slug: ${m[1]}`);
        }
    }
    if (!SLUG_RE.test(slug)) {
        throw new CommandExecutionError(`LinkedIn company name has unexpected characters: ${slug}`);
    }
    return `https://www.linkedin.com/company/${encodeURIComponent(slug)}/about/`;
}

function buildCompanyExtractionScript() {
    return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[  ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const facts = {};
    for (const dt of Array.from(document.querySelectorAll('dt'))) {
      const key = clean(dt.innerText || dt.textContent || '').toLowerCase().replace(/:$/, '');
      const dd = dt.nextElementSibling;
      const val = dd ? clean(dd.innerText || dd.textContent || '') : '';
      if (key && val && !(key in facts)) facts[key] = val;
    }
    const name = clean((document.querySelector('main h1') || document.querySelector('h1'))?.innerText || '');
    const bodyText = clean(document.body ? (document.body.innerText || '') : '');
    const followersMatch = bodyText.match(/([\d,]+)\s+followers/i);
    const aboutHeading = Array.from(document.querySelectorAll('main h2, section h2')).find((el) => /^About$|^Overview$/i.test(clean(el.innerText || '')));
    const aboutSection = aboutHeading ? aboutHeading.closest('section') : null;
    const about = aboutSection ? clean((aboutSection.innerText || '').replace(/^About\s*/i, '').replace(/^Overview\s*/i, '')) : '';
    return {
      url: window.location.href,
      name,
      industry: facts['industry'] || '',
      size: facts['company size'] || '',
      headquarters: facts['headquarters'] || '',
      founded: facts['founded'] || '',
      website: facts['website'] || '',
      specialties: facts['specialties'] || '',
      followers: followersMatch ? followersMatch[1].replace(/,/g, '') : '',
      about: about.slice(0, 2000),
    };
  })()`;
}

function normalizeCompanyOutputUrl(value, fallbackUrl) {
    const raw = normalizeWhitespace(value || fallbackUrl);
    let parsed;
    try {
        parsed = new URL(raw, `https://${LINKEDIN_DOMAIN}`);
    } catch {
        throw new CommandExecutionError('LinkedIn company extraction returned a malformed current URL');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !LINKEDIN_COMPANY_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw new CommandExecutionError('LinkedIn company extraction ended on a non-LinkedIn page');
    }
    const match = parsed.pathname.match(COMPANY_URL_RE);
    if (!match?.[1]) {
        throw new CommandExecutionError('LinkedIn company extraction ended outside a company page');
    }
    let slug;
    try {
        slug = decodeURIComponent(match[1]);
    } catch {
        throw new CommandExecutionError('LinkedIn company extraction returned a malformed company slug');
    }
    return `https://${LINKEDIN_DOMAIN}/company/${encodeURIComponent(slug)}/about/`;
}

function normalizeCompanyInfo(info, targetUrl) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
        throw new CommandExecutionError('LinkedIn company extraction returned a malformed payload');
    }
    if (!info.name) {
        throw new CommandExecutionError('LinkedIn company page rendered but no company name was found (layout drift or company not found)');
    }
    let followers = 0;
    if (info.followers) {
        followers = Number(info.followers);
        if (!Number.isFinite(followers)) {
            throw new CommandExecutionError('LinkedIn company extraction returned a malformed followers count');
        }
    }
    return {
        name: String(info.name),
        industry: String(info.industry || ''),
        size: String(info.size || ''),
        headquarters: String(info.headquarters || ''),
        founded: String(info.founded || ''),
        website: String(info.website || ''),
        specialties: String(info.specialties || ''),
        followers,
        about: String(info.about || ''),
        url: normalizeCompanyOutputUrl(info.url, targetUrl),
    };
}

cli({
    site: 'linkedin',
    name: 'company',
    access: 'read',
    description: 'Read a LinkedIn company page: industry, size, HQ, founded, website, followers, about',
    domain: LINKEDIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'company', type: 'string', required: true, positional: true, help: 'Company universal name (nvidia), /company/<name> path, or full URL' },
    ],
    columns: ['name', 'industry', 'size', 'headquarters', 'founded', 'website', 'specialties', 'followers', 'about', 'url'],
    func: async (page, kwargs) => {
        const targetUrl = normalizeCompanyUrl(kwargs.company);
        await page.goto(targetUrl);
        await page.wait(2);
        await assertLinkedInAuthenticated(page, 'linkedin company');
        const info = unwrapEvaluateResult(await page.evaluate(buildCompanyExtractionScript()));
        return [normalizeCompanyInfo(info, targetUrl)];
    },
});

export const __test__ = { normalizeCompanyUrl, normalizeCompanyInfo, buildCompanyExtractionScript };
