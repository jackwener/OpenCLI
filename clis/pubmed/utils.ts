/**
 * PubMed adapter utilities.
 *
 * PubMed provides the E-utilities API for programmatic access.
 * https://www.ncbi.nlm.nih.gov/books/NBK25501/
 *
 * Rate limits: 3 requests/second without API key, 10 requests/second with API key
 */

import { CliError } from '@jackwener/opencli/errors';
import { getApiKey, getEmail, getRateLimitMs } from './config.js';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * Build E-utilities API URL
 * Automatically includes API key if configured
 */
export function buildEutilsUrl(
  tool: string,
  params: Record<string, string | number | boolean | undefined>
): string {
  const searchParams = new URLSearchParams();
  searchParams.append('db', 'pubmed');
  searchParams.append('retmode', 'json');

  // Add API key if available
  const apiKey = getApiKey();
  if (apiKey) {
    searchParams.append('api_key', apiKey);
  }

  // Add email if available (recommended by NCBI)
  const email = getEmail();
  if (email) {
    searchParams.append('email', email);
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });

  return `${EUTILS_BASE}/${tool}.fcgi?${searchParams.toString()}`;
}

/**
 * Fetch data from E-utilities API with dynamic rate limiting
 * Rate limit adjusts based on API key presence:
 * - With API key: 100ms delay (10 req/s)
 * - Without API key: 350ms delay (3 req/s)
 */
export async function eutilsFetch(
  tool: string,
  params: Record<string, string | number | boolean | undefined>
): Promise<any> {
  const url = buildEutilsUrl(tool, params);

  // Dynamic rate limiting based on API key
  const rateLimitMs = getRateLimitMs();
  await new Promise(resolve => setTimeout(resolve, rateLimitMs));

  const resp = await fetch(url);

  if (!resp.ok) {
    // Handle specific error codes
    if (resp.status === 429) {
      throw new CliError(
        'RATE_LIMIT_EXCEEDED',
        'PubMed API rate limit exceeded',
        'You are making requests too quickly. Wait a moment and try again, or configure an API key for higher limits: opencli pubmed config set api-key YOUR_KEY'
      );
    }
    if (resp.status === 403) {
      throw new CliError(
        'API_KEY_INVALID',
        'PubMed API key invalid or expired',
        'Check your API key: opencli pubmed config get'
      );
    }
    throw new CliError(
      'FETCH_ERROR',
      `PubMed E-utilities API HTTP ${resp.status}`,
      'Check your query parameters or try again later'
    );
  }

  return resp.json();
}

/**
 * Fetch data from E-utilities API as text (for XML responses like EFetch)
 */
export async function eutilsFetchText(
  tool: string,
  params: Record<string, string | number | boolean | undefined>
): Promise<string> {
  const url = buildEutilsUrl(tool, params);

  // Dynamic rate limiting based on API key
  const rateLimitMs = getRateLimitMs();
  await new Promise(resolve => setTimeout(resolve, rateLimitMs));

  const resp = await fetch(url);

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new CliError(
        'RATE_LIMIT_EXCEEDED',
        'PubMed API rate limit exceeded',
        'You are making requests too quickly. Wait a moment and try again, or configure an API key for higher limits: opencli pubmed config set api-key YOUR_KEY'
      );
    }
    if (resp.status === 403) {
      throw new CliError(
        'API_KEY_INVALID',
        'PubMed API key invalid or expired',
        'Check your API key: opencli pubmed config get'
      );
    }
    throw new CliError(
      'FETCH_ERROR',
      `PubMed E-utilities API HTTP ${resp.status}`,
      'Check your query parameters or try again later'
    );
  }

  return resp.text();
}

/**
 * Parse PubMed date string to ISO format
 */
export function parsePubMedDate(dateStr: string): string {
  if (!dateStr) return '';

  // Handle various PubMed date formats
  // YYYY, YYYY Mon, YYYY Mon DD, YYYY Mon-DD, YYYY-MM-DD
  const patterns = [
    { regex: /^(\d{4})$/, format: (m: RegExpMatchArray) => `${m[1]}-01-01` },
    { regex: /^(\d{4})\s+([A-Za-z]{3})$/, format: (m: RegExpMatchArray) => {
      const months: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      };
      const month = months[m[2].toLowerCase()] || '01';
      return `${m[1]}-${month}-01`;
    }},
    { regex: /^(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})$/, format: (m: RegExpMatchArray) => {
      const months: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      };
      const month = months[m[2].toLowerCase()] || '01';
      const day = m[3].padStart(2, '0');
      return `${m[1]}-${month}-${day}`;
    }},
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, format: (m: RegExpMatchArray) => m[0] }
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern.regex);
    if (match) {
      return pattern.format(match);
    }
  }

  return dateStr;
}

/**
 * Extract author list from PubMed article
 */
export function extractAuthors(authorList: any[] | undefined, maxAuthors: number = 3): string {
  if (!authorList || !Array.isArray(authorList) || authorList.length === 0) {
    return '';
  }

  const authors = authorList.slice(0, maxAuthors).map(author => {
    if (author.collectivename) {
      return author.collectivename;
    }
    const lastName = author.lastname || '';
    const initials = author.initials || '';
    return `${lastName} ${initials}`.trim();
  });

  if (authorList.length > maxAuthors) {
    authors.push('et al.');
  }

  return authors.join(', ');
}

/**
 * Extract first author
 */
export function extractFirstAuthor(authorList: any[] | undefined): string {
  if (!authorList || !Array.isArray(authorList) || authorList.length === 0) {
    return '';
  }

  const firstAuthor = authorList[0];
  if (firstAuthor.collectivename) {
    return firstAuthor.collectivename;
  }

  const lastName = firstAuthor.lastname || '';
  const foreName = firstAuthor.forename || firstAuthor.initials || '';
  return `${lastName} ${foreName}`.trim();
}

/**
 * Extract corresponding author (usually last author in academic papers)
 */
export function extractCorrespondingAuthor(authorList: any[] | undefined): string {
  if (!authorList || !Array.isArray(authorList) || authorList.length === 0) {
    return '';
  }

  const lastAuthor = authorList[authorList.length - 1];
  if (lastAuthor.collectivename) {
    return lastAuthor.collectivename;
  }

  const lastName = lastAuthor.lastname || '';
  const foreName = lastAuthor.forename || lastAuthor.initials || '';
  return `${lastName} ${foreName}`.trim();
}

/**
 * Extract author affiliations
 */
export function extractAffiliations(authorList: any[] | undefined): string[] {
  if (!authorList || !Array.isArray(authorList)) {
    return [];
  }

  const affiliations: string[] = [];
  authorList.forEach(author => {
    if (author.affiliation && Array.isArray(author.affiliation)) {
      author.affiliation.forEach((aff: any) => {
        if (aff.name) {
          affiliations.push(aff.name);
        }
      });
    }
  });

  return [...new Set(affiliations)]; // Remove duplicates
}

/**
 * Extract MeSH terms
 */
export function extractMeshTerms(meshHeadingList: any[] | undefined): string[] {
  if (!meshHeadingList || !Array.isArray(meshHeadingList)) {
    return [];
  }

  return meshHeadingList
    .filter((heading: any) => heading.descriptorname)
    .map((heading: any) => heading.descriptorname)
    .slice(0, 10);
}

/**
 * Extract keywords
 */
export function extractKeywords(keywordList: any[] | undefined): string[] {
  if (!keywordList || !Array.isArray(keywordList)) {
    return [];
  }

  return keywordList
    .filter((kw: any) => kw.keyword)
    .map((kw: any) => kw.keyword)
    .slice(0, 10);
}

/**
 * Extract DOI from article IDs
 */
export function extractDoi(articleIdList: any[] | undefined): string {
  if (!articleIdList || !Array.isArray(articleIdList)) {
    return '';
  }

  const doiEntry = articleIdList.find((id: any) => id.idtype === 'doi');
  return doiEntry?.value || '';
}

/**
 * Extract PMC ID from article IDs
 */
export function extractPmcId(articleIdList: any[] | undefined): string {
  if (!articleIdList || !Array.isArray(articleIdList)) {
    return '';
  }

  const pmcEntry = articleIdList.find((id: any) => id.idtype === 'pmc');
  return pmcEntry?.value || '';
}

/**
 * Build PubMed URL from PMID
 */
export function buildPubMedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return text.slice(0, maxLength) + '...';
}

/**
 * Format article type
 */
export function formatArticleType(pubTypeList: any[] | undefined): string {
  if (!pubTypeList || !Array.isArray(pubTypeList) || pubTypeList.length === 0) {
    return 'Journal Article';
  }

  const mainType = pubTypeList.find((pt: any) => pt.ui);
  return mainType?.value || pubTypeList[0]?.value || 'Journal Article';
}

/**
 * Extract journal information
 */
export function extractJournalInfo(journal: any): {
  title: string;
  isoAbbreviation: string;
  impactFactor?: string;
} {
  if (!journal) {
    return { title: '', isoAbbreviation: '' };
  }

  const title = journal.title || '';
  const isoAbbreviation = journal.isoabbreviation || '';

  return {
    title,
    isoAbbreviation,
  };
}

/**
 * Build search query with filters
 */
export function buildSearchQuery(
  query: string,
  filters: {
    author?: string;
    journal?: string;
    yearFrom?: number;
    yearTo?: number;
    articleType?: string;
    hasAbstract?: boolean;
    hasFullText?: boolean;
    humanOnly?: boolean;
    englishOnly?: boolean;
  }
): string {
  let searchTerms: string[] = [query];

  if (filters.author) {
    searchTerms.push(`${filters.author}[Author]`);
  }

  if (filters.journal) {
    searchTerms.push(`${filters.journal}[Journal]`);
  }

  if (filters.yearFrom || filters.yearTo) {
    const from = filters.yearFrom || '1900';
    const to = filters.yearTo || new Date().getFullYear();
    searchTerms.push(`${from}:${to}[PDAT]`);
  }

  if (filters.articleType) {
    searchTerms.push(`${filters.articleType}[PT]`);
  }

  if (filters.hasAbstract) {
    searchTerms.push('hasabstract[text]');
  }

  if (filters.hasFullText) {
    searchTerms.push('free full text[sb]');
  }

  if (filters.humanOnly) {
    searchTerms.push('humans[mesh]');
  }

  if (filters.englishOnly) {
    searchTerms.push('english[lang]');
  }

  return searchTerms.join(' AND ');
}
