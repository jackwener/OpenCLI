import { ArgumentError, CommandExecutionError } from '../../errors.js';

export const SEARCH_INPUT_SELECTOR = '#composeQuerySmartSearch';
export const SUBMIT_BUTTON_SELECTOR = "button[aria-label='Submit your question']";
export const MAX_LIMIT = 50;

export type WosDatabase = 'woscc' | 'alldb';
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
      return type === 'submit' || /search/i.test(text);
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

  const selector = await page.evaluate(`(() => {
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
