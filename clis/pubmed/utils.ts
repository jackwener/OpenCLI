/**
 * PubMed adapter utilities.
 *
 * PubMed provides the E-utilities API for programmatic access.
 * https://www.ncbi.nlm.nih.gov/books/NBK25501/
 *
 * Rate limits: 3 requests/second without API key, 10 requests/second with API key
 *
 * Configuration via environment variables:
 * - NCBI_API_KEY: Your NCBI API key for higher rate limits
 * - NCBI_EMAIL: Your email (recommended by NCBI for identification)
 */

import { CliError } from '@jackwener/opencli/errors';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * Get API key from environment variable
 */
function getApiKey(): string | undefined {
  return process.env.NCBI_API_KEY;
}

/**
 * Get email from environment variable (recommended by NCBI for identification)
 */
function getEmail(): string | undefined {
  return process.env.NCBI_EMAIL;
}

/**
 * Get rate limit delay in milliseconds
 * With API key: 100ms (10 req/s)
 * Without API key: 350ms (3 req/s)
 */
function getRateLimitMs(): number {
  return getApiKey() ? 100 : 350;
}

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

  // Allow callers to override retmode (e.g., EFetch needs retmode=xml)
  if (!params.retmode) {
    searchParams.append('retmode', 'json');
  }

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
 *
 * @param tool - E-utilities tool name (esearch, esummary, efetch, etc.)
 * @param params - Query parameters
 * @param retmode - Response format: 'json' (default) or 'xml' (for EFetch)
 */
export async function eutilsFetch(
  tool: string,
  params: Record<string, string | number | boolean | undefined>,
  retmode: 'json' | 'xml' = 'json'
): Promise<any> {
  const mergedParams = { ...params, retmode };
  const url = buildEutilsUrl(tool, mergedParams);

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
        'You are making requests too quickly. Wait a moment and try again, or configure an API key (NCBI_API_KEY environment variable)'
      );
    }
    if (resp.status === 403) {
      throw new CliError(
        'API_KEY_INVALID',
        'PubMed API key invalid or expired',
        'Check your NCBI_API_KEY environment variable'
      );
    }
    throw new CliError(
      'FETCH_ERROR',
      `PubMed E-utilities API HTTP ${resp.status}`,
      'Check your query parameters or try again later'
    );
  }

  return retmode === 'xml' ? resp.text() : resp.json();
}

/**
 * Extract author list from PubMed article
 */
export function extractAuthors(authorList: any[] | undefined, maxAuthors: number = 3): string {
  if (!authorList || !Array.isArray(authorList) || authorList.length === 0) {
    return '';
  }

  const authors = authorList.slice(0, maxAuthors).map(author => {
    // ESummary format: { name, authtype, clusterid }
    if (author.name) {
      return author.name;
    }
    // EFetch format: { lastname, forename, initials, collectivename }
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

  // ESummary format: pubtype is a string array e.g. ["Journal Article"]
  if (typeof pubTypeList[0] === 'string') {
    return prioritizeArticleType(pubTypeList as string[]);
  }

  // EFetch format: pubtype is an object array e.g. [{ ui: "D016428", value: "Journal Article" }]
  const values = pubTypeList.map((pt: any) => pt.value).filter(Boolean);
  return prioritizeArticleType(values);
}

/**
 * Prioritize article types - return the most specific/meaningful type
 * "Journal Article" is generic, prefer more specific types like "Review", "Meta-Analysis", etc.
 */
export function prioritizeArticleType(pubTypes: string[]): string {
  if (!pubTypes || pubTypes.length === 0) {
    return 'Journal Article';
  }

  // Define priority: more specific types are preferred over generic "Journal Article"
  const priorityOrder = [
    'Systematic Review',
    'Meta-Analysis',
    'Review',
    'Randomized Controlled Trial',
    'Clinical Trial',
    'Case Reports',
    'Comparative Study',
    'Multicenter Study',
    'Observational Study',
    'Editorial',
    'Comment',
    'Letter',
    'News',
    'Published Erratum',
    'Guideline',
    'Practice Guideline',
    'Consensus Development Conference',
    'Congress',
    'Lecture',
    'Interview',
    'Biography',
    'Portrait',
    'Historical Article',
    'Classical Article',
    'Legal Case',
    'Legislation',
    'Government Publication',
    'Technical Report',
    'Dataset',
    'Evaluation Study',
    'Validation Study',
    'Research Support, Non-U.S. Gov\'t',
    'Research Support, U.S. Gov\'t, Non-P.H.S.',
    'Research Support, U.S. Gov\'t, P.H.S.',
    'Research Support, N.I.H., Extramural',
    'Research Support, N.I.H., Intramural',
    'Research Support, American Recovery and Reinvestment Act',
    'Journal Article',  // Generic, low priority
  ];

  // Find the highest priority type present in the list
  for (const priorityType of priorityOrder) {
    const match = pubTypes.find(pt =>
      pt.toLowerCase() === priorityType.toLowerCase()
    );
    if (match) {
      return match;
    }
  }

  // If no priority match, return the first non-generic type or the first one
  const nonGeneric = pubTypes.find(pt =>
    pt.toLowerCase() !== 'journal article'
  );
  return nonGeneric || pubTypes[0];
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
