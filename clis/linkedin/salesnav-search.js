import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SALES_HOME = 'https://www.linkedin.com/sales/';
const LEAD_SEARCH_BASE = 'https://www.linkedin.com/sales-api/salesApiLeadSearch';
// Versioned response decoration. LinkedIn bumps this on Sales Navigator
// redeploys; if the response shape ever changes, refresh it from a live
// /sales/search/people request.
const LEAD_SEARCH_DECORATION = 'com.linkedin.sales.deco.desktop.searchv2.LeadSearchResult-14';
const PAGE_SIZE = 25;

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function requireStringArg(args, key, label = key) {
  const value = normalizeWhitespace(args[key]);
  if (!value) throw new ArgumentError(`${label} is required`);
  return value;
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return 25;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ArgumentError('--limit must be an integer between 1 and 500');
  }
  return limit;
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

// Sales Navigator keeps the structural ( ) , : of the query literal and only
// percent-encodes the keyword value.
function leadSearchUrl(keywords, start) {
  const query = '(spellCorrectionEnabled:true,recentSearchParam:(doLogHistory:true),keywords:'
    + encodeURIComponent(keywords) + ')';
  return LEAD_SEARCH_BASE
    + '?q=searchQuery&query=' + query
    + '&start=' + start + '&count=' + PAGE_SIZE
    + '&decorationId=' + LEAD_SEARCH_DECORATION;
}

function fetchLeadSearchScript(url, csrf) {
  return String.raw`(async () => {
    const headers = {
      'csrf-token': ${JSON.stringify(csrf)},
      'x-restli-protocol-version': '2.0.0',
      accept: 'application/json',
    };
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers });
      if (res.status === 401 || res.status === 403) return { authRequired: true, status: res.status };
      if (!res.ok) return { error: 'HTTP ' + res.status };
      return { json: await res.json() };
    } catch (e) {
      return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
  })()`;
}

// Sales Navigator search returns no /in/ vanity URL, but the entityUrn carries
// the obfuscated member token, and linkedin.com/in/<token> is a valid profile
// URL that the connect command accepts.
function profileUrlFromEntityUrn(entityUrn) {
  const match = String(entityUrn || '').match(/fs_salesProfile:\(([^,)]+)/);
  return match && match[1] ? 'https://www.linkedin.com/in/' + match[1] : '';
}

function leadUrlFromEntityUrn(entityUrn) {
  const match = String(entityUrn || '').match(/^urn:li:fs_salesProfile:\(([^,()]+),([^,()]+),([^,()]+)\)$/);
  if (!match) return '';
  return `https://www.linkedin.com/sales/lead/${encodeURIComponent(match[1])},${encodeURIComponent(match[2])},${encodeURIComponent(match[3])}`;
}

function parseLeads(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) {
    throw new CommandExecutionError('Sales Navigator lead search API returned malformed payload');
  }
  const leads = [];
  for (const el of json.elements) {
    if (!el || typeof el !== 'object') {
      throw new CommandExecutionError('Sales Navigator lead search API returned malformed lead row');
    }
    const current = Array.isArray(el.currentPositions) ? el.currentPositions : [];
    const past = Array.isArray(el.pastPositions) ? el.pastPositions : [];
    const pos = current[0] || past[0] || {};
    const name = normalizeWhitespace(el.fullName || [el.firstName, el.lastName].filter(Boolean).join(' '));
    if (!name) {
      throw new CommandExecutionError('Sales Navigator lead row missing name');
    }
    const entityUrn = normalizeWhitespace(el.entityUrn || '');
    if (!profileUrlFromEntityUrn(entityUrn)) {
      throw new CommandExecutionError('Sales Navigator lead row missing profile identity');
    }
    leads.push({
      name,
      title: normalizeWhitespace(pos.title || ''),
      company: normalizeWhitespace(pos.companyName || ''),
      location: normalizeWhitespace(el.geoRegion || ''),
      degree: normalizeWhitespace(el.degree || ''),
      profile_url: profileUrlFromEntityUrn(entityUrn),
      lead_url: leadUrlFromEntityUrn(entityUrn),
      recipient_urn: entityUrn,
    });
  }
  return leads;
}

function requireLeadSearchResult(result) {
  if (result?.authRequired) {
    throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn Sales Navigator API auth failed (HTTP ' + (result.status || '') + '). Confirm the account has Sales Navigator access.');
  }
  if (result?.error) {
    throw new CommandExecutionError('Sales Navigator lead search API returned an unexpected response', result.error);
  }
  if (!result || !result.json) {
    throw new CommandExecutionError('Sales Navigator lead search API returned an unexpected response', 'no_json');
  }
  return result.json;
}

cli({
  site: 'linkedin',
  name: 'salesnav-search',
  access: 'read',
  description: 'Search LinkedIn Sales Navigator for people leads by keyword',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'keywords', type: 'string', required: true, positional: true, help: 'People search keywords, e.g. "quality manager food manufacturing"' },
    { name: 'limit', type: 'number', default: 25, help: 'Maximum leads to return (1-500, fetched 25 per request)' },
  ],
  columns: ['rank', 'name', 'title', 'company', 'location', 'degree', 'profile_url', 'lead_url', 'recipient_urn'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin salesnav-search');
    const keywords = requireStringArg(args, 'keywords', '--keywords');
    const limit = parseLimit(args.limit);

    await page.goto(SALES_HOME);
    await page.wait(6);

    const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
    const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    if (!jsession) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn.');
    }
    const csrf = jsession.replace(/^\"|\"$/g, '');

    const leads = [];
    const seen = new Set();
    for (let start = 0; leads.length < limit && start < 2000; start += PAGE_SIZE) {
      const result = unwrapEvaluateResult(await page.evaluate(fetchLeadSearchScript(leadSearchUrl(keywords, start), csrf)));
      const json = requireLeadSearchResult(result);
      const pageLeads = parseLeads(json);
      if (pageLeads.length === 0) break;
      for (const lead of pageLeads) {
        const key = lead.profile_url || lead.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        leads.push(lead);
      }
      await page.wait(1);
    }

    if (leads.length === 0) {
      throw new EmptyResultError('linkedin salesnav-search', 'No Sales Navigator leads were found.');
    }
    return leads.slice(0, limit).map((lead, index) => ({ rank: index + 1, ...lead }));
  },
});

export const __test__ = {
  normalizeWhitespace,
  parseLimit,
  leadSearchUrl,
  profileUrlFromEntityUrn,
  leadUrlFromEntityUrn,
  parseLeads,
  requireLeadSearchResult,
};
