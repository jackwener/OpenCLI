import { ArgumentError, CommandExecutionError } from '../../errors.js';

export const SEARCH_INPUT_SELECTOR = '#composeQuerySmartSearch';
export const SUBMIT_BUTTON_SELECTOR = "button[aria-label='Submit your question']";
export const MAX_LIMIT = 50;

export type WosDatabase = 'woscc' | 'alldb';
export type BasicSearchFieldKey =
  | 'all_fields'
  | 'topic'
  | 'title'
  | 'author'
  | 'publication_titles'
  | 'year_published'
  | 'affiliation'
  | 'funding_agency'
  | 'publisher'
  | 'publication_date'
  | 'abstract'
  | 'accession_number'
  | 'address'
  | 'author_identifiers'
  | 'author_keywords'
  | 'conference'
  | 'document_type'
  | 'doi'
  | 'editor'
  | 'grant_number'
  | 'group_author'
  | 'keyword_plus'
  | 'language'
  | 'pubmed_id'
  | 'web_of_science_categories';

export type BasicSearchFieldSpec = {
  key: BasicSearchFieldKey;
  label: string;
  tag: string;
  aliases: string[];
};

export type WosEvent = {
  key?: string;
  payload?: Record<string, any>;
};

export type WosRecord = {
  ut?: string;
  doi?: string;
  coll?: string;
  titles?: {
    item?: { en?: Array<{ title?: string }> };
    source?: { en?: Array<{ title?: string }> };
  };
  names?: {
    author?: { en?: Array<{ first_name?: string; last_name?: string; wos_standard?: string }> };
  };
  pub_info?: {
    pubyear?: string;
    sortdate?: string;
  };
  abstract?: {
    basic?: {
      en?: {
        abstract?: string | string[];
      };
    };
  };
  keywords?: Record<string, { en?: Array<string | { keyword?: string; value?: string; text?: string }> }>;
  citation_related?: {
    counts?: Record<string, number>;
  };
};

type RecordIdentifier =
  | { kind: 'ut'; value: string; database?: WosDatabase }
  | { kind: 'doi'; value: string; database?: WosDatabase };

type AuthorRecordIdentifier = {
  id: string;
};

export function clampLimit(value: unknown): number {
  const parsed = Number(value ?? 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export function normalizeDatabase(value: unknown, fallback: WosDatabase = 'woscc'): WosDatabase {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'woscc' || normalized === 'alldb') return normalized;
  throw new ArgumentError(`Unsupported Web of Science database: ${String(value)}`);
}

export function toProduct(database: WosDatabase): 'WOSCC' | 'ALLDB' {
  return database === 'alldb' ? 'ALLDB' : 'WOSCC';
}

export function smartSearchUrl(database: WosDatabase): string {
  return `https://webofscience.clarivate.cn/wos/${database}/smart-search`;
}

export function basicSearchUrl(database: WosDatabase): string {
  return `https://webofscience.clarivate.cn/wos/${database}/basic-search`;
}

export function fullRecordUrl(database: WosDatabase, ut: string): string {
  return `https://webofscience.clarivate.cn/wos/${database}/full-record/${ut}`;
}

export function citingSummaryUrl(database: WosDatabase, ut: string): string {
  return `https://webofscience.clarivate.cn/wos/${database}/citing-summary/${ut}?from=${database}&type=colluid&siloSearchWarning=false`;
}

export function citedReferencesSummaryUrl(database: WosDatabase, ut: string): string {
  return `https://webofscience.clarivate.cn/wos/${database}/cited-references-summary/${ut}?from=${database}&type=colluid`;
}

export function authorRecordUrl(id: string): string {
  return `https://webofscience.clarivate.cn/wos/author/record/${id}`;
}

export function buildSearchPayload(
  query: string,
  limit: number,
  database: WosDatabase,
  rowText = `TS=(${query})`,
): Record<string, unknown> {
  const product = toProduct(database);

  return {
    product,
    searchMode: 'general_semantic',
    viewType: 'search',
    serviceMode: 'summary',
    search: {
      mode: 'general_semantic',
      database: product,
      disableEdit: false,
      query: [{ rowText }],
      display: {
        key: 'nlp',
        params: { input: query },
      },
      blending: 'blended',
      count: 100,
    },
    retrieve: {
      count: limit,
      history: true,
      jcr: true,
      sort: 'relevance',
      analyzes: [
        'TP.Value.6',
        'REVIEW.Value.6',
        'EARLY ACCESS.Value.6',
        'OA.Value.6',
        'DR.Value.6',
        'ECR.Value.6',
        'PY.Field_D.6',
        'FPY.Field_D.6',
        'DT.Value.6',
        'AU.Value.6',
        'DX2NG.Value.6',
        'PEERREVIEW.Value.6',
        'STK.Value.10',
      ],
      locale: 'en',
    },
    eventMode: null,
  };
}

const BASIC_SEARCH_FIELDS: BasicSearchFieldSpec[] = [
  { key: 'all_fields', label: 'All Fields', tag: 'ALL', aliases: ['all-fields', 'all fields', 'all_fields', 'all'] },
  { key: 'topic', label: 'Topic', tag: 'TS', aliases: ['topic', 'ts'] },
  { key: 'title', label: 'Title', tag: 'TI', aliases: ['title', 'ti'] },
  { key: 'author', label: 'Author', tag: 'AU', aliases: ['author', 'au'] },
  { key: 'publication_titles', label: 'Publication Titles', tag: 'SO', aliases: ['publication-titles', 'publication titles', 'publication_titles', 'publication title', 'source', 'so'] },
  { key: 'year_published', label: 'Year Published', tag: 'PY', aliases: ['year-published', 'year published', 'year_published', 'year', 'py'] },
  { key: 'affiliation', label: 'Affiliation', tag: 'OG', aliases: ['affiliation', 'organization-enhanced', 'organization_enhanced', 'organization enhanced', 'og'] },
  { key: 'funding_agency', label: 'Funding Agency', tag: 'FO', aliases: ['funding-agency', 'funding agency', 'funding_agency', 'fo'] },
  { key: 'publisher', label: 'Publisher', tag: 'PUBL', aliases: ['publisher', 'publ'] },
  { key: 'publication_date', label: 'Publication Date', tag: 'DOP', aliases: ['publication-date', 'publication date', 'publication_date', 'date of publication', 'dop'] },
  { key: 'abstract', label: 'Abstract', tag: 'AB', aliases: ['abstract', 'ab'] },
  { key: 'accession_number', label: 'Accession Number', tag: 'UT', aliases: ['accession-number', 'accession number', 'accession_number', 'ut'] },
  { key: 'address', label: 'Address', tag: 'AD', aliases: ['address', 'ad'] },
  { key: 'author_identifiers', label: 'Author Identifiers', tag: 'AI', aliases: ['author-identifiers', 'author identifiers', 'author_identifiers', 'ai'] },
  { key: 'author_keywords', label: 'Author Keywords', tag: 'AK', aliases: ['author-keywords', 'author keywords', 'author_keywords', 'ak'] },
  { key: 'conference', label: 'Conference', tag: 'CF', aliases: ['conference', 'cf'] },
  { key: 'document_type', label: 'Document Type', tag: 'DT', aliases: ['document-type', 'document type', 'document_type', 'dt'] },
  { key: 'doi', label: 'DOI', tag: 'DO', aliases: ['doi', 'do'] },
  { key: 'editor', label: 'Editor', tag: 'ED', aliases: ['editor', 'ed'] },
  { key: 'grant_number', label: 'Grant Number', tag: 'FG', aliases: ['grant-number', 'grant number', 'grant_number', 'fg'] },
  { key: 'group_author', label: 'Group Author', tag: 'GP', aliases: ['group-author', 'group author', 'group_author', 'gp'] },
  { key: 'keyword_plus', label: 'Keyword Plus', tag: 'KP', aliases: ['keyword-plus', 'keyword plus', 'keyword_plus', 'keywords plus', 'keywords-plus', 'kp'] },
  { key: 'language', label: 'Language', tag: 'LA', aliases: ['language', 'la'] },
  { key: 'pubmed_id', label: 'PubMed ID', tag: 'PMID', aliases: ['pubmed-id', 'pubmed id', 'pubmed_id', 'pmid'] },
  { key: 'web_of_science_categories', label: 'Web of Science Categories', tag: 'WC', aliases: ['web-of-science-categories', 'web of science categories', 'web_of_science_categories', 'wos categories', 'wc'] },
];

export function listBasicSearchFields(): BasicSearchFieldSpec[] {
  return [...BASIC_SEARCH_FIELDS];
}

export function normalizeBasicSearchField(value: unknown): BasicSearchFieldSpec {
  if (value == null || value === '') {
    return BASIC_SEARCH_FIELDS.find(field => field.key === 'topic')!;
  }

  const normalized = String(value).trim().toLowerCase();
  const match = BASIC_SEARCH_FIELDS.find(field =>
    field.aliases.includes(normalized)
    || field.key === normalized.replace(/[\s-]+/g, '_')
    || field.label.toLowerCase() === normalized);

  if (!match) {
    throw new ArgumentError(`Unsupported Web of Science basic-search field: ${String(value)}`);
  }

  return match;
}

export function buildBasicSearchRowText(query: string, field: unknown): string {
  const spec = normalizeBasicSearchField(field);
  return `${spec.tag}=(${query})`;
}

export function extractSessionState(page: { evaluate: (js: string) => Promise<any> }): Promise<{ sid?: string | null; href?: string }> {
  return page.evaluate(`(() => {
    const entry = performance.getEntriesByType('resource')
      .find(e => String(e.name).includes('/api/wosnx/core/runQuerySearch?SID='));
    const sid = entry ? new URL(entry.name).searchParams.get('SID') : null;
    return { sid, href: location.href };
  })()`);
}

export async function ensureSearchSession(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    typeText: (selector: string, text: string) => Promise<any>;
    click: (selector: string) => Promise<any>;
    pressKey: (key: string) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  database: WosDatabase,
  query: string,
): Promise<string> {
  return ensureSearchSessionAtUrl(page, smartSearchUrl(database), query, SEARCH_INPUT_SELECTOR);
}

export async function ensureSearchSessionAtUrl(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    typeText: (selector: string, text: string) => Promise<any>;
    click: (selector: string) => Promise<any>;
    pressKey: (key: string) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  url: string,
  query: string,
  preferredSelector?: string,
): Promise<string> {
  await page.goto(url, { settleMs: 4000 });
  await page.wait(2);
  await typeIntoSearch(page, query, preferredSelector);
  await page.wait(1);
  await submitSearch(page);
  await page.wait(6);

  let session = await extractSessionState(page);
  if (!session?.sid) {
    await submitSearch(page);
    await page.wait(10);
    session = await extractSessionState(page);
  }

  if (!session?.sid) {
    throw new CommandExecutionError(
      'Web of Science search session was not established',
      'The page may still be waiting for passive verification. Try again in Chrome.',
    );
  }

  return session.sid;
}

export function isWosSubmitControl(input: {
  text?: string | null;
  type?: string | null;
  ariaLabel?: string | null;
}): boolean {
  const text = String(input.text || '').trim().toLowerCase();
  const type = String(input.type || '').trim().toLowerCase();
  const ariaLabel = String(input.ariaLabel || '').trim().toLowerCase();
  const hay = `${text} ${ariaLabel}`.trim();

  if (!hay && type !== 'submit') return false;
  if (hay.includes('history')) return false;
  if (hay.includes('saved searches')) return false;
  if (hay.includes('search history')) return false;

  return type === 'submit'
    || /^search\b/.test(hay)
    || hay.includes('submit your question');
}

async function submitSearch(page: {
  click: (selector: string) => Promise<any>;
  pressKey: (key: string) => Promise<any>;
  evaluate: (js: string) => Promise<any>;
}): Promise<void> {
  try {
    await page.click(SUBMIT_BUTTON_SELECTOR);
    return;
  } catch {}

  const submitRef = await findVisibleSubmitButtonRef(page);
  if (submitRef) {
    try {
      await page.click(String(submitRef));
      return;
    } catch {}
  }

  await page.pressKey('Enter');
}

async function findVisibleSubmitButtonRef(page: { evaluate: (js: string) => Promise<any> }): Promise<string | null> {
  const ref = await page.evaluate(`(() => {
    const submitRef = 'opencli-search-submit';
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    for (const node of document.querySelectorAll('[data-ref="opencli-search-submit"]')) {
      node.removeAttribute('data-ref');
    }
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      .filter((el) => !el.disabled && isVisible(el));
    const target = buttons.find((el) => {
      const text = String(el.textContent || el.getAttribute('value') || '').trim();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const ariaLabel = String(el.getAttribute('aria-label') || '').trim();
      const hay = (text + ' ' + ariaLabel).toLowerCase();
      if (hay.includes('history')) return false;
      if (hay.includes('saved searches')) return false;
      if (hay.includes('search history')) return false;
      return type === 'submit'
        || /^search\b/.test(hay)
        || hay.includes('submit your question');
    });
    if (!target) return null;
    target.setAttribute('data-ref', submitRef);
    return submitRef;
  })()`);
  return typeof ref === 'string' ? ref : null;
}

async function typeIntoSearch(
  page: {
    wait: (seconds: number) => Promise<any>;
    typeText: (selector: string, text: string) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  query: string,
  preferredSelector?: string,
): Promise<void> {
  const discoveredRef = 'opencli-search-input';

  if (preferredSelector) {
    try {
      await page.typeText(preferredSelector, query);
      return;
    } catch {
      // Fall back to generic input discovery below.
    }
  }

  let selector: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    selector = await page.evaluate(`(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    for (const node of document.querySelectorAll('[data-ref="opencli-search-input"]')) {
      node.removeAttribute('data-ref');
    }
    const candidates = Array.from(document.querySelectorAll('input, textarea'))
      .filter((el) => !el.disabled && !el.readOnly && isVisible(el))
      .sort((a, b) => {
        const aScore = (a.matches('input[type="search"], input[type="text"], textarea') ? 10 : 0) + (a.placeholder ? 2 : 0);
        const bScore = (b.matches('input[type="search"], input[type="text"], textarea') ? 10 : 0) + (b.placeholder ? 2 : 0);
        return bScore - aScore;
      });
    const target = candidates[0];
    if (!target) return null;
    target.setAttribute('data-ref', ${JSON.stringify(discoveredRef)});
    return ${JSON.stringify(discoveredRef)};
  })()`);
    if (selector) break;
    if (attempt < 2) {
      await page.wait(2);
    }
  }

  if (!selector) {
    throw new CommandExecutionError(
      'Web of Science search input was not found',
      'The search page may not have finished loading. Try again in Chrome.',
    );
  }

  try {
    await page.typeText(String(selector), query);
  } catch {
    await page.wait(4);
    await page.typeText(String(selector), query);
  }
}

export function formatAuthors(record: WosRecord): string {
  const authors = record.names?.author?.en ?? [];
  return authors
    .map(author => {
      if (!author) return '';
      if (author.wos_standard) return author.wos_standard;
      const last = author.last_name?.trim();
      const first = author.first_name?.trim();
      if (last && first) return `${last}, ${first}`;
      return last || first || '';
    })
    .filter(Boolean)
    .join('; ');
}

export function firstTitle(record: WosRecord, branch: 'item' | 'source'): string {
  return record.titles?.[branch]?.en?.[0]?.title ?? '';
}

export function extractRecords(events: unknown): WosRecord[] {
  if (!Array.isArray(events)) return [];
  const eventList = events as WosEvent[];

  const errors = eventList
    .filter(event => event?.key === 'error')
    .flatMap(event => Array.isArray(event.payload) ? event.payload : []);
  if (errors.includes('Server.passiveVerificationRequired')) {
    throw new CommandExecutionError(
      'Web of Science requested passive verification before search results could be fetched',
      'Try again in Chrome after the verification completes.',
    );
  }
  if (errors.includes('Server.sessionNotFound')) {
    throw new CommandExecutionError(
      'Web of Science search session expired before results could be fetched',
      'Try running the command again.',
    );
  }

  const recordsPayload = eventList.find(event => event?.key === 'records')?.payload ?? {};
  return Object.values(recordsPayload) as WosRecord[];
}

export function extractQueryId(events: unknown): string {
  if (!Array.isArray(events)) return '';
  const eventList = events as WosEvent[];
  return String(eventList.find(event => event?.key === 'searchInfo')?.payload?.QueryID ?? '');
}

export function parseRecordIdentifier(input: string): RecordIdentifier | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (/doi\.org$/i.test(url.hostname)) {
      const doi = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return doi ? { kind: 'doi', value: doi } : null;
    }

    const match = url.pathname.match(/\/wos\/(woscc|alldb)\/full-record\/([^/?#]+)/i);
    if (match) {
      return {
        kind: 'ut',
        value: decodeURIComponent(match[2]),
        database: normalizeDatabase(match[1]),
      };
    }
  } catch {
    // Not a URL; continue parsing as a bare identifier.
  }

  if (/^WOS:[A-Z0-9]+$/i.test(trimmed)) {
    return { kind: 'ut', value: trimmed.toUpperCase() };
  }

  if (/^10\.\d{4,9}\/\S+$/i.test(trimmed)) {
    return { kind: 'doi', value: trimmed };
  }

  return null;
}

export function parseAuthorRecordIdentifier(input: string): AuthorRecordIdentifier | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/wos\/author\/record\/([^/?#]+)/i);
    if (match) {
      return { id: decodeURIComponent(match[1]) };
    }
  } catch {
    // Not a URL; continue parsing as a bare identifier.
  }

  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed };
  }

  return null;
}

export function buildExactQuery(identifier: RecordIdentifier): string {
  return identifier.kind === 'ut'
    ? `UT=(${identifier.value})`
    : `DO=(${identifier.value})`;
}

export function findMatchingRecord(records: WosRecord[], identifier: RecordIdentifier): { record: WosRecord; docNumber: number } | null {
  const needle = identifier.value.trim().toLowerCase();

  for (const [index, record] of records.entries()) {
    if (identifier.kind === 'ut' && record.ut?.trim().toLowerCase() === needle) {
      return { record, docNumber: index + 1 };
    }
    if (identifier.kind === 'doi' && record.doi?.trim().toLowerCase() === needle) {
      return { record, docNumber: index + 1 };
    }
  }

  return records[0] ? { record: records[0], docNumber: 1 } : null;
}

export function buildFullRecordPayload(params: {
  qid: string;
  docNumber: number;
  product: string;
  coll?: string;
  searchMode?: string;
}): Record<string, unknown> {
  const { qid, docNumber, product, coll = product, searchMode = 'general_semantic' } = params;

  return {
    qid,
    id: docNumber,
    retrieve: {
      first: docNumber,
      links: 'retrieve',
      sort: 'relevance',
      count: 1,
      view: 'full',
      coll,
      activity: true,
      analyzes: null,
      jcr: true,
      reviews: true,
      highlight: false,
      locale: 'en',
    },
    product,
    searchMode,
    serviceMode: 'summary',
    viewType: 'records',
    paginated: false,
  };
}

export function extractFullRecord(events: unknown): WosRecord | null {
  if (!Array.isArray(events)) return null;
  const eventList = events as WosEvent[];
  return (eventList.find(event => event?.key === 'full-record')?.payload as WosRecord | undefined) ?? null;
}

function joinValues(items: Array<string | { keyword?: string; value?: string; text?: string }> | undefined): string {
  return (items ?? [])
    .map(item => {
      if (typeof item === 'string') return item.trim();
      return item.keyword?.trim() || item.value?.trim() || item.text?.trim() || '';
    })
    .filter(Boolean)
    .join('; ');
}

export function extractAbstract(record: WosRecord): string {
  const value = record.abstract?.basic?.en?.abstract;
  const text = Array.isArray(value) ? value.filter(Boolean).join(' ') : (typeof value === 'string' ? value : '');
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractKeywordGroup(record: WosRecord, key: string): string {
  return joinValues(record.keywords?.[key]?.en);
}

export async function fetchSummaryRecords(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  url: string,
  database: WosDatabase,
  limit: number,
  defaultMode: string,
): Promise<WosRecord[]> {
  async function fetchOnce(): Promise<unknown> {
    return page.evaluate(`(async () => {
    const href = String(location.href || '');
    const summaryId = href.match(/\\/summary\\/([^/]+)/)?.[1] || '';
    const pageNumber = Number(href.match(/\\/summary\\/[^/]+\\/[^/]+\\/(\\d+)/)?.[1] || '1') || 1;
    const sort = href.match(/\\/summary\\/[^/]+\\/([^/]+)\\/\\d+/)?.[1] || 'relevance';
    const sid = (() => {
      try { return JSON.parse(String(localStorage.getItem('wos_sid') || '""')) || ''; } catch { return ''; }
    })();
    if (!summaryId || !sid) return [];

    const rawState = localStorage.getItem('wos_search_' + summaryId);
    const searchState = rawState ? JSON.parse(rawState) : null;
    const product = ${JSON.stringify(toProduct(database))};
    const retrieveBase = {
      count: ${limit},
      first: Math.max(1, ((pageNumber - 1) * ${limit}) + 1),
      sort,
      locale: 'en',
      jcr: true,
      history: true,
    };
    const baseState = {
      ...(searchState || { id: summaryId, mode: ${JSON.stringify(defaultMode)}, database: product }),
      id: summaryId,
      database: searchState?.database || product,
      product,
      serviceMode: 'summary',
    };
    const candidates = [
      {
        ...baseState,
        retrieve: retrieveBase,
        searchMode: searchState?.mode || ${JSON.stringify(defaultMode)},
        viewType: 'summary',
        paginated: true,
      },
      {
        ...baseState,
        retrieve: { ...retrieveBase, coll: searchState?.database || product, view: 'summary' },
        searchMode: 'GeneralSearch',
        viewType: 'records',
        paginated: true,
      },
      {
        ...baseState,
        retrieve: { ...retrieveBase, coll: searchState?.database || product, activity: true },
        searchMode: 'GeneralSearch',
        viewType: 'summary',
        paginated: false,
      },
      {
        ...baseState,
        retrieve: { ...retrieveBase, coll: searchState?.database || product, activity: true },
        searchMode: searchState?.mode || 'GeneralSearch',
        viewType: 'records',
        paginated: false,
      },
    ];

    for (const payload of candidates) {
      const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(sid), {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!text || /^<!doctype/i.test(text.trim())) {
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {}
    }

    return [];
  })()`);
  }

  await page.goto(url, { settleMs: 5000 });
  await page.wait(6);

  let records = extractRecords(await fetchOnce());
  if (!records.length) {
    await page.wait(4);
    records = extractRecords(await fetchOnce());
  }

  return records;
}

export function parseWosEventStream(text: string): WosEvent[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as WosEvent[];
    }
  } catch {
    // Fall back to line-delimited parsing below.
  }

  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as WosEvent];
      } catch {
        return [];
      }
    });
}

export async function fetchCurrentSummaryStreamRecords(
  page: {
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  database: WosDatabase,
  limit: number,
  defaultMode: string,
): Promise<WosRecord[]> {
  async function fetchOnce(): Promise<{ streamText: string; debug: Record<string, any> }> {
    return page.evaluate(`(async () => {
    const href = String(location.href || '');
    const qid = href.match(/\\/summary\\/([^/]+)/)?.[1] || '';
    const pageNumber = Number(href.match(/\\/summary\\/[^/]+\\/[^/]+\\/(\\d+)/)?.[1] || '1') || 1;
    const sort = href.match(/\\/summary\\/[^/]+\\/([^/]+)\\/\\d+/)?.[1] || 'relevance';
    const sid = (() => {
      try { return JSON.parse(String(localStorage.getItem('wos_sid') || '""')) || ''; } catch { return ''; }
    })();
    const searchState = (() => {
      if (!qid) return null;
      try { return JSON.parse(String(localStorage.getItem('wos_search_' + qid) || 'null')); } catch { return null; }
    })();
    if (!qid || !sid) {
      return {
        streamText: '',
        debug: {
          href,
          qid,
          pageNumber,
          sort,
          sid,
          hasSearchState: !!searchState,
          searchMode: searchState?.mode || ${JSON.stringify(defaultMode)},
          product: ${JSON.stringify(toProduct(database))},
          reason: 'missing-qid-or-sid',
        },
      };
    }

    const payload = {
      qid,
      retrieve: {
        first: Math.max(1, ((pageNumber - 1) * ${MAX_LIMIT}) + 1),
        sort,
        count: ${MAX_LIMIT},
        jcr: true,
        highlight: false,
        analyzes: [],
      },
      product: ${JSON.stringify(toProduct(database))},
      searchMode: searchState?.mode || ${JSON.stringify(defaultMode)},
      viewType: 'records',
    };

    const res = await fetch('/api/wosnx/core/runQueryGetRecordsStream?SID=' + encodeURIComponent(sid), {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const streamText = await res.text();
    return {
      streamText,
      debug: {
        href,
        qid,
        pageNumber,
        sort,
        sid,
        hasSearchState: !!searchState,
        searchMode: searchState?.mode || ${JSON.stringify(defaultMode)},
        product: ${JSON.stringify(toProduct(database))},
        responseOk: res.ok,
        responseStatus: res.status,
        textSnippet: String(streamText || '').slice(0, 500),
      },
    };
  })()`);
  }
  await page.wait(6);

  let first = await fetchOnce();
  let records = extractRecords(parseWosEventStream(String(first?.streamText || '')));
  if (!records.length) {
    await page.wait(4);
    const second = await fetchOnce();
    records = extractRecords(parseWosEventStream(String(second?.streamText || '')));
    if (!records.length && process.env.OPENCLI_WOS_DEBUG_SUMMARY === '1') {
      throw new CommandExecutionError(`Web of Science summary stream returned no records: ${JSON.stringify({
        first: first?.debug || {},
        second: second?.debug || {},
      })}`);
    }
  }

  return records;
}

export async function fetchSummaryStreamRecords(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
    tabs?: () => Promise<any[]>;
    selectTab?: (index: number) => Promise<any>;
  },
  url: string,
  database: WosDatabase,
  limit: number,
  defaultMode: string,
): Promise<WosRecord[]> {
  const targetPath = new URL(url).pathname;
  const summaryMarker = '/summary/';
  await page.goto(url, { settleMs: 5000 });
  if (typeof page.tabs === 'function' && typeof page.selectTab === 'function') {
    try {
      const tabs = await page.tabs();
      const matching = Array.isArray(tabs)
        ? tabs.find(tab => {
            const href = String(tab?.url || '');
            return typeof tab?.index === 'number' && (href.includes(targetPath) || href.includes(summaryMarker));
          })
        : undefined;
      if (matching && typeof matching.index === 'number') {
        await page.selectTab(matching.index);
      }
    } catch {
      // Best-effort: stay on current tab if tab discovery fails.
    }
  }
  try {
    const href = String(await page.evaluate(`(() => String(location.href || ''))()` ) || '');
    if (!href.includes(summaryMarker)) {
      await page.evaluate(`(() => { location.href = ${JSON.stringify(url)}; return true; })()`);
      await page.wait(6);
    }
  } catch {
    // Ignore navigation verification failures and let fetch diagnostics handle it.
  }
  return fetchCurrentSummaryStreamRecords(page, database, limit, defaultMode);
}

export async function scrapeBodyTextAndLinks(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  url: string,
): Promise<{ bodyText: string; links: Array<{ label?: string; url?: string }> }> {
  await page.goto(url, { settleMs: 5000 });
  const readOnce = () => page.evaluate(`(() => {
    const normalize = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a'))
      .map((el) => ({
        label: normalize(el.textContent || el.getAttribute('aria-label') || ''),
        url: String(el.href || '').trim(),
      }))
      .filter((item) => item.url);
    return {
      bodyText: String(document.body.innerText || '').replace(/\\u00a0/g, ' '),
      links,
    };
  })()`);

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.wait(2 + attempt);
    const result = await readOnce();
    const bodyText = typeof result?.bodyText === 'string' ? result.bodyText : '';
    const links = Array.isArray(result?.links) ? result.links : [];
    if (bodyText.trim()) {
      return { bodyText, links };
    }
  }

  return { bodyText: '', links: [] };
}
