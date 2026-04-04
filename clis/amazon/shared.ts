import { ArgumentError, CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

export const SITE = 'amazon';
export const DOMAIN = 'amazon.com';
export const HOME_URL = 'https://www.amazon.com/';
export const BESTSELLERS_URL = 'https://www.amazon.com/Best-Sellers/zgbs';
export const NEW_RELEASES_URL = 'https://www.amazon.com/gp/new-releases';
export const MOVERS_SHAKERS_URL = 'https://www.amazon.com/gp/movers-and-shakers';
export const SEARCH_URL_PREFIX = 'https://www.amazon.com/s?k=';
export const PRODUCT_URL_PREFIX = 'https://www.amazon.com/dp/';
export const DISCUSSION_URL_PREFIX = 'https://www.amazon.com/product-reviews/';
export const STRATEGY = 'cookie';
export const PRIMARY_PRICE_SELECTORS = [
  '#corePrice_feature_div .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-offscreen',
  '#corePrice_desktop .a-offscreen',
  '#apex_desktop .a-offscreen',
  '#newAccordionRow_0 .a-offscreen',
  '#price_inside_buybox',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#tp_price_block_total_price_ww',
];

const ROBOT_TEXT_PATTERNS = [
  'Sorry, we just need to make sure you\'re not a robot',
  'Enter the characters you see below',
  'Type the characters you see in this image',
  'To discuss automated access to Amazon data please contact',
];

export type AmazonRankingListType = 'bestsellers' | 'new_releases' | 'movers_shakers';

interface AmazonRankingSpec {
  commandName: string;
  rootUrl: string;
  pathPattern: RegExp;
  invalidInputMessage: string;
  invalidInputHint: string;
}

const AMAZON_RANKING_SPECS: Record<AmazonRankingListType, AmazonRankingSpec> = {
  bestsellers: {
    commandName: 'bestsellers',
    rootUrl: BESTSELLERS_URL,
    pathPattern: /(?:^|\/)zgbs(?:\/|$)/i,
    invalidInputMessage: 'amazon bestsellers expects a best sellers URL or /zgbs path',
    invalidInputHint: 'Example: opencli amazon bestsellers https://www.amazon.com/Best-Sellers/zgbs',
  },
  new_releases: {
    commandName: 'new-releases',
    rootUrl: NEW_RELEASES_URL,
    pathPattern: /\/gp\/new-releases(?:\/|$)/i,
    invalidInputMessage: 'amazon new-releases expects a new releases URL or /gp/new-releases path',
    invalidInputHint: 'Example: opencli amazon new-releases https://www.amazon.com/gp/new-releases',
  },
  movers_shakers: {
    commandName: 'movers-shakers',
    rootUrl: MOVERS_SHAKERS_URL,
    pathPattern: /\/gp\/movers-and-shakers(?:\/|$)/i,
    invalidInputMessage: 'amazon movers-shakers expects a movers-and-shakers URL or /gp/movers-and-shakers path',
    invalidInputHint: 'Example: opencli amazon movers-shakers https://www.amazon.com/gp/movers-and-shakers',
  },
};

export interface ProvenanceFields {
  source_url: string;
  fetched_at: string;
  strategy: string;
}

export interface PageState {
  href: string;
  title: string;
  body_text: string;
}

export interface PriceValue {
  price_text: string | null;
  price_value: number | null;
  currency: string | null;
}

export function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function cleanMultilineText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    : '';
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

export function buildProvenance(sourceUrl: string): ProvenanceFields {
  return {
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    strategy: STRATEGY,
  };
}

export function buildSearchUrl(query: string): string {
  const normalized = cleanText(query);
  if (!normalized) {
    throw new ArgumentError('amazon search query cannot be empty');
  }
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(normalized)}`;
}

export function extractAsin(input: string): string | null {
  const normalized = cleanText(input);
  if (!normalized) return null;
  if (/^[A-Z0-9]{10}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  const match = normalized.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

export function buildProductUrl(input: string): string {
  const asin = extractAsin(input);
  if (!asin) {
    throw new ArgumentError(
      'amazon product expects an ASIN or product URL',
      'Example: opencli amazon product B0FJS72893',
    );
  }
  return `${PRODUCT_URL_PREFIX}${asin}`;
}

export function buildDiscussionUrl(input: string): string {
  const asin = extractAsin(input);
  if (!asin) {
    throw new ArgumentError(
      'amazon discussion expects an ASIN or product URL',
      'Example: opencli amazon discussion B0FJS72893',
    );
  }
  return `${DISCUSSION_URL_PREFIX}${asin}`;
}

function getRankingSpec(listType: AmazonRankingListType): AmazonRankingSpec {
  return AMAZON_RANKING_SPECS[listType];
}

export function isSupportedRankingPath(listType: AmazonRankingListType, inputUrl: string): boolean {
  try {
    const url = new URL(inputUrl);
    return getRankingSpec(listType).pathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

export function resolveRankingUrl(listType: AmazonRankingListType, input?: string): string {
  const spec = getRankingSpec(listType);
  const normalized = cleanText(input);
  if (!normalized || normalized === 'root') return spec.rootUrl;

  let candidateUrl: string;
  if (normalized.startsWith('/')) {
    candidateUrl = new URL(normalized, HOME_URL).toString();
  } else if (/^https?:\/\//i.test(normalized)) {
    candidateUrl = canonicalizeAmazonUrl(normalized);
  } else if (normalized.includes('amazon.') && normalized.includes('/')) {
    candidateUrl = canonicalizeAmazonUrl(`https://${normalized.replace(/^\/+/, '')}`);
  } else {
    throw new ArgumentError(spec.invalidInputMessage, spec.invalidInputHint);
  }

  if (!isSupportedRankingPath(listType, candidateUrl)) {
    throw new ArgumentError(spec.invalidInputMessage, spec.invalidInputHint);
  }
  return normalizeRankingInputUrl(candidateUrl);
}

function normalizeRankingInputUrl(inputUrl: string): string {
  try {
    const url = new URL(inputUrl);
    const normalizedPathSegments = url.pathname
      .split('/')
      .filter(Boolean)
      .filter((segment) => !/^ref=/i.test(segment));
    url.pathname = `/${normalizedPathSegments.join('/')}`;
    url.hash = '';
    // Ranking pages are frequently shared with tracking refs that can land on unstable variants.
    // Dropping ref keeps the canonical ranking path while preserving useful params (for example pg=2).
    url.searchParams.delete('ref');
    return url.toString();
  } catch {
    return inputUrl;
  }
}

export function isRankingPaginationUrl(listType: AmazonRankingListType, inputUrl: string): boolean {
  const absolute = toAbsoluteAmazonUrl(inputUrl);
  if (!absolute || !isSupportedRankingPath(listType, absolute)) return false;

  try {
    const url = new URL(absolute);
    const ref = cleanText(url.searchParams.get('ref')).toLowerCase();
    // pg= query param is the most reliable pagination indicator across all ranking lists
    return url.searchParams.has('pg')
      || /(?:^|_)pg(?:_|$)/.test(ref)
      // Amazon ranking pagination refs: zg_bs_pg_ (bestsellers), zg_bsnr_pg_ (new releases), zg_bsms_pg_ (movers & shakers)
      || /zg_bs(?:nr|ms)?_pg_/.test(ref);
  } catch {
    return false;
  }
}

export function extractCategoryNodeId(inputUrl: string | null | undefined): string | null {
  const absolute = toAbsoluteAmazonUrl(inputUrl);
  if (!absolute) return null;

  try {
    const url = new URL(absolute);

    for (const key of ['node', 'nodeid', 'nodeId', 'browseNode']) {
      const value = cleanText(url.searchParams.get(key));
      if (/^\d{4,}$/.test(value)) return value;
    }

    const rhValue = cleanText(url.searchParams.get('rh'));
    const rhMatch = decodeURIComponent(rhValue).match(/(?:^|,)\s*n:(\d{4,})(?:,|$)/i);
    if (rhMatch) return rhMatch[1];

    const pathMatches = [...url.pathname.matchAll(/\/(\d{4,})(?=\/|$)/g)];
    if (pathMatches.length > 0) {
      return pathMatches[pathMatches.length - 1][1];
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveBestsellersUrl(input?: string): string {
  return resolveRankingUrl('bestsellers', input);
}

export function canonicalizeAmazonUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!url.hostname.endsWith(DOMAIN)) {
      throw new Error('not-amazon');
    }
    return url.toString();
  } catch {
    throw new ArgumentError('Invalid Amazon URL');
  }
}

export function toAbsoluteAmazonUrl(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  if (!normalized) return null;
  try {
    return new URL(normalized, HOME_URL).toString();
  } catch {
    return null;
  }
}

export function normalizeProductUrl(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  const asin = extractAsin(normalized);
  if (asin) return buildProductUrl(asin);
  return toAbsoluteAmazonUrl(normalized);
}

export function parsePriceText(text: string | null | undefined): PriceValue {
  const normalized = cleanText(text);
  const match = normalized.match(/([$€£])\s*(\d+(?:,\d{3})*(?:\.\d+)?)/);
  if (!match) {
    return {
      price_text: normalized || null,
      price_value: null,
      currency: null,
    };
  }

  const currencyMap: Record<string, string> = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
  };

  return {
    price_text: `${match[1]}${match[2]}`,
    price_value: Number.parseFloat(match[2].replace(/,/g, '')),
    currency: currencyMap[match[1]] ?? null,
  };
}

export function parseRatingValue(text: string | null | undefined): number | null {
  const normalized = cleanText(text);
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*out of 5/i);
  return match ? Number.parseFloat(match[1]) : null;
}

export function parseReviewCount(text: string | null | undefined): number | null {
  const normalized = cleanText(text);
  const compactMatch = normalized.match(/(\d+(?:\.\d+)?)\s*([kKmM])/);
  if (compactMatch) {
    const value = Number.parseFloat(compactMatch[1]);
    const multiplier = /m/i.test(compactMatch[2]) ? 1_000_000 : 1_000;
    return Number.isFinite(value) ? Math.round(value * multiplier) : null;
  }
  const match = normalized.match(/([\d,]+)/);
  return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : null;
}

export function extractReviewCountFromCardText(text: string | null | undefined): string | null {
  const normalized = cleanMultilineText(text);
  const match = normalized.match(/out of 5 stars(?:, rating details)?\s*([\d,]+)/i);
  if (match) return match[1];

  const numericLine = normalized
    .split('\n')
    .map((line) => cleanText(line))
    .find((line) => /^[\d,]+$/.test(line));
  return numericLine ?? null;
}

export function isAmazonEntity(text: string | null | undefined): boolean {
  const normalized = cleanText(text).toLowerCase();
  return normalized.includes('amazon');
}

export function firstMeaningfulLine(text: string | null | undefined): string {
  return cleanMultilineText(text)
    .split('\n')
    .map((line) => cleanText(line))
    .find(Boolean)
    ?? '';
}

export function trimRatingPrefix(text: string | null | undefined): string | null {
  const normalized = cleanText(text);
  if (!normalized) return null;
  return normalized.replace(/^\d+(?:\.\d+)?\s*out of 5 stars\s*/i, '').trim() || normalized;
}

export function isRobotState(state: Partial<PageState>): boolean {
  const title = cleanText(state.title);
  const bodyText = cleanMultilineText(state.body_text);
  return ROBOT_TEXT_PATTERNS.some((pattern) => title.includes(pattern) || bodyText.includes(pattern));
}

export function buildChallengeHint(action: string): string {
  return [
    `Open a clean Amazon ${action} page in the shared Chrome profile and clear any robot check first.`,
    'If you are using CDP, set OPENCLI_CDP_TARGET=amazon.com and avoid parallel Amazon commands against the same browser target.',
  ].join(' ');
}

export async function readPageState(page: IPage): Promise<PageState> {
  const result = await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      body_text: document.body ? document.body.innerText || '' : '',
    }))()
  `) as Partial<PageState>;

  return {
    href: cleanText(result.href),
    title: cleanText(result.title),
    body_text: cleanMultilineText(result.body_text),
  };
}

export async function gotoAndReadState(
  page: IPage,
  url: string,
  settleMs: number = 2500,
  action: string = 'page',
): Promise<PageState> {
  try {
    await page.goto(url, { settleMs });
    await page.wait(1.5);
    return await readPageState(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Inspected target navigated or closed')
      || message.includes('Cannot find context with specified id')
      || message.includes('Target closed')
    ) {
      throw new CommandExecutionError(
        `amazon ${action} navigation lost the current browser target`,
        `${buildChallengeHint(action)} If CDP is attached to a stale tab, open a fresh Amazon tab and retry.`,
      );
    }
    throw error;
  }
}

export function assertUsableState(state: PageState, action: string): void {
  if (!isRobotState(state)) return;
  throw new CommandExecutionError(
    `amazon ${action} hit a robot check`,
    buildChallengeHint(action),
  );
}

export const __test__ = {
  buildSearchUrl,
  extractAsin,
  buildProductUrl,
  buildDiscussionUrl,
  resolveBestsellersUrl,
  resolveRankingUrl,
  isSupportedRankingPath,
  isRankingPaginationUrl,
  extractCategoryNodeId,
  parsePriceText,
  parseRatingValue,
  parseReviewCount,
  extractReviewCountFromCardText,
  isAmazonEntity,
  trimRatingPrefix,
  isRobotState,
  PRIMARY_PRICE_SELECTORS,
};
