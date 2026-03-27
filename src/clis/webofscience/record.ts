import { cli, Strategy } from '../../registry.js';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '../../errors.js';
import {
  buildExactQuery,
  buildFullRecordPayload,
  buildSearchPayload,
  ensureSearchSession,
  extractAbstract,
  extractFullRecord,
  extractKeywordGroup,
  extractQueryId,
  extractRecords,
  findMatchingRecord,
  firstTitle,
  formatAuthors,
  fullRecordUrl,
  normalizeDatabase,
  parseRecordIdentifier,
  toProduct,
} from './shared.js';

type RecordPageSupplement = {
  metadata?: Record<string, string>;
  fullTextLinks?: Array<{ label?: string; url?: string }>;
};

const UI_NOISE_LINES = new Set([
  'arrow_drop_down',
  'arrow_back',
  'arrow_forward',
  'chevron_right',
  'add',
]);

const SECTION_LABELS = new Set([
  'Keywords',
  'Author Information',
  'Corresponding Address',
  'E-mail Addresses',
  'Addresses',
  'Categories/ Classification',
  'Research Areas',
  'Citation Topics',
  'Web of Science Categories',
  'Journal information',
  'View Journal Impact',
  'ISSN',
  'Current Publisher',
  'Journal Impact Factor',
  'Journal Citation Reports TM',
  'Citation Network',
]);

function normalizeTextValue(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTextLines(body: string): string[] {
  return body
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function isSectionBoundary(line: string, extraLabels: string[] = []): boolean {
  if (SECTION_LABELS.has(line)) return true;
  if (extraLabels.includes(line)) return true;
  if (/^See more/i.test(line)) return true;
  if (/^How does this document/i.test(line)) return true;
  return false;
}

function extractSectionLines(body: string, label: string, endLabels: string[] = []): string[] {
  const lines = getTextLines(body);
  const startIndex = lines.findIndex(line => line === label);
  if (startIndex < 0) return [];

  const values: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (UI_NOISE_LINES.has(line)) continue;
    if (isSectionBoundary(line, endLabels)) break;
    values.push(line);
  }
  return values;
}

function extractInlineOrSectionValue(body: string, label: string, endLabels: string[] = []): string {
  const lines = getTextLines(body);
  for (const [index, line] of lines.entries()) {
    if (line === label) {
      const values = extractSectionLines(body, label, endLabels);
      return normalizeTextValue(values.join(' '));
    }
    if (line.startsWith(label)) {
      const inline = normalizeTextValue(line.slice(label.length));
      if (inline) return inline;
      for (let next = index + 1; next < lines.length; next++) {
        const candidate = lines[next];
        if (UI_NOISE_LINES.has(candidate)) continue;
        if (isSectionBoundary(candidate, endLabels)) break;
        if (candidate) return normalizeTextValue(candidate);
      }
    }
  }
  return '';
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(normalizeTextValue).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function stripTrailingMetadataLabels(value: string): string {
  const normalized = normalizeTextValue(value);
  if (!normalized) return '';

  const trailingLabelPattern = /\s(?:Language|Accession Number|PubMed ID|ISSN|IDS Number)\b/i;
  const match = normalized.match(trailingLabelPattern);
  return match?.index != null
    ? normalized.slice(0, match.index).trim()
    : normalized;
}

function normalizeDelimitedList(value: string): string {
  const normalized = normalizeTextValue(value);
  if (!normalized) return '';

  return normalized
    .replace(/([a-z)])(?=[A-Z][a-z])/g, '$1; ')
    .replace(/([a-z)])\s+(?=[A-Z][a-z].*?,)/g, '$1; ')
    .replace(/;\s*;/g, '; ')
    .trim();
}

function extractCategoryList(value: string): string {
  const normalized = normalizeTextValue(value);
  if (!normalized) return '';

  const matches = normalized.match(/[A-Z][A-Za-z&/\-]+(?:\s+[A-Z][A-Za-z&/\-]+)*,\s+[A-Z][A-Za-z&/\-]+(?:\s+[A-Z][A-Za-z&/\-]+)*?(?=(?:[A-Z][A-Za-z&/\-]+(?:\s+[A-Z][A-Za-z&/\-]+)*,\s+[A-Z])|$)/g);
  if (matches?.length) {
    return uniqueValues(matches.map(normalizeTextValue)).join('; ');
  }

  return normalizeDelimitedList(normalized);
}

function cleanAuthorLine(value: string): { name: string; refs: string[] } | null {
  const normalized = normalizeTextValue(value);
  if (!normalized) return null;
  if (!/,/.test(normalized)) return null;
  if (/\b(view|provided|source|arrow|journal|impact|publisher)\b/i.test(normalized)) return null;

  const refs = Array.from(normalized.matchAll(/\[(\d+(?:,\d+)*)\]/g))
    .flatMap(match => String(match[1] || '').split(','))
    .map(item => item.trim())
    .filter(Boolean);
  const parenthetical = normalized.match(/\(([^()]+,[^()]+)\)/)?.[1];
  const cleaned = normalizeTextValue(
    (parenthetical || normalized)
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/\([^()]*\)/g, parenthetical ? ' ' : '')
      .replace(/\s+\d+(?:,\d+)*$/g, ' ')
  );

  if (!cleaned || /\b(corresponding author)\b/i.test(cleaned)) return null;
  return { name: cleaned, refs };
}

function extractSectionValueList(body: string, label: string, endLabels: string[] = []): string[] {
  const values = extractSectionLines(body, label, endLabels)
    .flatMap((line) => normalizeDelimitedList(line).split(/\s*;\s*/g))
    .map(normalizeTextValue)
    .filter(Boolean);

  return uniqueValues(values);
}

function extractStructuredAuthors(body: string): Array<{
  name: string;
  address_refs: string[];
  addresses: string[];
}> {
  const lines = getTextLines(body);
  const byIndex = lines.findIndex(line => line === 'By');
  if (byIndex < 0) return [];

  const addressMap = new Map<string, string>();
  for (const line of extractSectionLines(body, 'Addresses', [
    'E-mail Addresses',
    'Categories/ Classification',
  ])) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    addressMap.set(match[1], normalizeTextValue(match[2]));
  }

  const authors: Array<{ name: string; address_refs: string[]; addresses: string[] }> = [];
  for (let index = byIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (isSectionBoundary(line, ['Addresses', 'E-mail Addresses', 'Keywords', 'Source', 'Abstract'])) break;
    const match = line.match(/^(.+?)(\d+(?:,\d+)*)$/);
    if (match) {
      const name = normalizeTextValue(match[1]);
      const refs = match[2].split(',').map(item => item.trim()).filter(Boolean);
      if (!name || !refs.length) continue;
      authors.push({
        name,
        address_refs: refs,
        addresses: refs.map(ref => addressMap.get(ref) || '').filter(Boolean),
      });
      continue;
    }

    const parsed = cleanAuthorLine(line);
    if (!parsed) continue;
    authors.push({
      name: parsed.name,
      address_refs: parsed.refs,
      addresses: parsed.refs.map(ref => addressMap.get(ref) || '').filter(Boolean),
    });
  }

  return authors;
}

export function extractSupplementMetadataFromText(body: string): Record<string, string> {
  const text = String(body || '').replace(/\u00a0/g, ' ');
  const metadata: Record<string, string> = {};
  const extract = (pattern: RegExp) => normalizeTextValue(text.match(pattern)?.[1] || '');

  const regexFields = {
    document_type: /Document Type\s+(.+?)\s+Abstract/s,
    article_number: /Article Number\s+(.+?)\s+Published/s,
    published: /Published\s+(.+?)\s+(?:Early Access|Indexed)/s,
    early_access: /Early Access\s+(.+?)\s+Indexed/s,
    indexed: /Indexed\s+(.+?)\s+Document Type/s,
    language: /Language\s+(.+?)\s+Accession Number/s,
    pubmed_id: /PubMed ID\s+(.+?)\s+ISSN/s,
    issn: /PubMed ID\s+.+?\s+ISSN\s+(.+?)\s+IDS Number/s,
    ids_number: /IDS Number\s+(.+?)\s+(?:add\s+See more data fields|Journal information)/s,
    current_publisher: /Current Publisher\s+(.+?)\s+Journal Impact Factor/s,
  } satisfies Record<string, RegExp>;

  for (const [key, pattern] of Object.entries(regexFields)) {
    const value = extract(pattern);
    if (value) metadata[key] = value;
  }

  const fallbackFields: Array<[keyof typeof metadata | string, string, string[]]> = [
    ['language', 'Language', ['Accession Number', 'PubMed ID', 'ISSN']],
    ['pubmed_id', 'PubMed ID', ['ISSN', 'IDS Number', 'Journal information']],
    ['issn', 'ISSN', ['IDS Number', 'Journal information', 'Current Publisher']],
    ['ids_number', 'IDS Number', ['Journal information', 'Current Publisher']],
  ];

  for (const [key, label, endLabels] of fallbackFields) {
    if (!metadata[key]) {
      const value = extractInlineOrSectionValue(text, label, endLabels);
      if (value) metadata[key] = value;
    }
  }

  const citedReferences = text.match(/(\d+)\s+Cited References/)?.[1];
  if (citedReferences) metadata.cited_references = citedReferences;

  const correspondingSection = extractSectionLines(text, 'Corresponding Address', [
    'E-mail Addresses',
    'Addresses',
    'Categories/ Classification',
  ]).filter(line => !/\(corresponding author\)/i.test(line));
  const correspondingAddress = uniqueValues(correspondingSection).at(-1) ?? '';
  if (correspondingAddress) metadata.corresponding_address = correspondingAddress;

  const addressSection = extractSectionLines(text, 'Addresses', [
    'E-mail Addresses',
    'Categories/ Classification',
  ]);
  const authorAddresses = uniqueValues(addressSection).join('; ');
  if (authorAddresses) metadata.author_addresses = authorAddresses;

  const emails = uniqueValues(Array.from(text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi), match => match[0]));
  if (emails.length) metadata.email_addresses = emails.join('; ');

  const researchAreas = extractInlineOrSectionValue(text, 'Research Areas', [
    'Citation Topics',
    'Web of Science Categories',
    'Journal information',
  ]);
  if (researchAreas) metadata.research_areas = researchAreas;

  const wosCategories = extractCategoryList(stripTrailingMetadataLabels(extractInlineOrSectionValue(text, 'Web of Science Categories', [
    'See more data fields',
    'Journal information',
    'Journal Impact Factor',
    'Citation Network',
  ])));
  if (wosCategories) metadata.wos_categories = wosCategories;

  const authorKeywords = extractSectionValueList(text, 'Author Keywords', [
    'Keywords Plus',
    'Author Information',
    'Corresponding Address',
  ]).join('; ');
  if (authorKeywords) metadata.author_keywords = authorKeywords;

  const keywordsPlus = extractSectionValueList(text, 'Keywords Plus', [
    'Author Information',
    'Corresponding Address',
    'Addresses',
  ]).join('; ');
  if (keywordsPlus) metadata.keywords_plus = keywordsPlus;

  const authorsStructured = extractStructuredAuthors(text);
  if (authorsStructured.length) metadata.authors_structured = JSON.stringify(authorsStructured);

  const currentPublisherLines = extractSectionLines(text, 'Current Publisher', [
    'Journal Impact Factor',
    'Journal Citation Reports TM',
    'Citation Network',
  ]);
  const currentPublisher = (uniqueValues(currentPublisherLines).join('; ')
    || extractInlineOrSectionValue(text, 'Current Publisher', [
      'Journal Impact Factor',
      'Journal Citation Reports TM',
      'Citation Network',
    ]))
    .replace(/([A-Z])(\d)/g, '$1; $2');
  if (currentPublisher) metadata.current_publisher = currentPublisher;

  if (metadata.wos_categories) {
    metadata.wos_categories = metadata.wos_categories
      .replace(/;\s*;/g, '; ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (metadata.current_publisher) {
    metadata.current_publisher = metadata.current_publisher
      .replace(/;\s*;/g, '; ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (metadata.authors_structured) {
    try {
      const parsed = JSON.parse(metadata.authors_structured) as Array<{ name?: string; address_refs?: string[]; addresses?: string[] }>;
      metadata.authors_structured = JSON.stringify(parsed.filter((item) => {
        const name = normalizeTextValue(String(item?.name || ''));
        return Boolean(name) && /,/.test(name) && !/\b(view|provided|source|arrow|journal|impact|publisher)\b/i.test(name);
      }));
    } catch {
      // Ignore malformed fallback author metadata.
    }
  }

  return metadata;
}

async function scrapeRecordPageSupplement(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  url: string,
): Promise<RecordPageSupplement> {
  await page.goto(url, { settleMs: 4000 });
  await page.wait(2);

  const supplement = await page.evaluate(`(async () => {
    const normalize = (text) => String(text || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    const fullTextButton = Array.from(document.querySelectorAll('button'))
      .find((el) => isVisible(el) && /full text links/i.test(String(el.textContent || '')));
    if (fullTextButton) {
      fullTextButton.click();
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const body = String(document.body.innerText || '').replace(/\\u00a0/g, ' ');

    const links = Array.from(document.querySelectorAll('a'))
      .map((el) => ({
        label: normalize(el.textContent || el.getAttribute('aria-label') || ''),
        url: String(el.href || '').trim(),
      }))
      .filter((item) => item.url);

    const filtered = [];
    const seen = new Set();
    for (const item of links) {
      const hay = (item.label + ' ' + item.url).toLowerCase();
      if (hay.includes('google scholar')) continue;
      if (hay.includes('journal citation reports')) continue;
      if (hay.includes('journal citation indicator')) continue;
      if (hay.includes('accessibility')) continue;
      if (hay.includes('/wos/pqdt/')) continue;
      const isFullText = hay.includes('context sensitive')
        || hay.includes('free full text')
        || hay.includes('view full text')
        || hay.includes('full text on proquest')
        || hay.includes('repository')
        || hay.includes('submitted article')
        || hay.includes('getftr')
        || /\\.pdf($|\\?)/i.test(item.url)
        || (hay.includes('proquest') && hay.includes('full text'));
      if (!isFullText) continue;
      const key = item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push({
        label: item.label || 'Full Text Link',
        url: item.url,
      });
    }

    return { bodyText: body, fullTextLinks: filtered };
  })()`);

  if (!supplement || typeof supplement !== 'object') {
    return {};
  }

  const bodyText = typeof (supplement as { bodyText?: unknown }).bodyText === 'string'
    ? (supplement as { bodyText: string }).bodyText
    : '';

  const legacyMetadata = typeof (supplement as { metadata?: unknown }).metadata === 'object'
    && (supplement as { metadata?: unknown }).metadata !== null
    ? (supplement as { metadata: Record<string, string> }).metadata
    : undefined;

  return {
    metadata: bodyText ? extractSupplementMetadataFromText(bodyText) : legacyMetadata,
    fullTextLinks: Array.isArray((supplement as { fullTextLinks?: unknown }).fullTextLinks)
      ? (supplement as { fullTextLinks: Array<{ label?: string; url?: string }> }).fullTextLinks
      : [],
  };
}

function hasSupplementData(supplement: RecordPageSupplement): boolean {
  return Boolean(
    Object.keys(supplement.metadata ?? {}).length
    || (supplement.fullTextLinks?.length ?? 0) > 0,
  );
}

cli({
  site: 'webofscience',
  name: 'record',
  description: 'Fetch a Web of Science full record by UT, DOI, or full-record URL',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'UT, DOI, or Web of Science full-record URL' },
    { name: 'database', required: false, help: 'Database to search', choices: ['woscc', 'alldb'] },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? '').trim();
    if (!rawId) {
      throw new ArgumentError('Record identifier is required');
    }

    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError('Record identifier must be a Web of Science UT, DOI, or full-record URL');
    }

    const database = normalizeDatabase(kwargs.database, identifier.database ?? 'woscc');
    const sid = await ensureSearchSession(page, database, rawId);
    const exactQuery = buildExactQuery(identifier);
    const searchPayload = buildSearchPayload(rawId, 5, database, exactQuery);

    const searchEvents = await page.evaluate(`(async () => {
      const payload = ${JSON.stringify(searchPayload)};
      const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    })()`);

    const queryId = extractQueryId(searchEvents);
    const records = extractRecords(searchEvents);
    const match = findMatchingRecord(records, identifier);

    if (!queryId || !match?.record) {
      throw new EmptyResultError('webofscience record', 'Try using a Web of Science UT, DOI, or verify your Web of Science access in Chrome');
    }

    const product = toProduct(database);
    const fullRecordPayload = buildFullRecordPayload({
      qid: queryId,
      docNumber: match.docNumber,
      product,
      coll: match.record.coll ?? product,
      searchMode: 'general_semantic',
    });

    let record = match.record;
    try {
      const fullRecordEvents = await page.evaluate(`(async () => {
        const payload = ${JSON.stringify(fullRecordPayload)};
        const res = await fetch('/api/wosnx/core/getFullRecordByQueryId?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return res.json();
      })()`);

      const fullRecord = extractFullRecord(fullRecordEvents);
      if (fullRecord) {
        record = fullRecord;
      }
    } catch {
      // Fall back to the exact-match search record. The full-record endpoint
      // can return HTML when the site decides to render a page flow instead.
    }

    const recordUrl = record.ut ? fullRecordUrl(database, record.ut) : '';
    let supplement: RecordPageSupplement = {};
    if (recordUrl) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          supplement = await scrapeRecordPageSupplement(page, recordUrl);
          if (hasSupplementData(supplement)) break;
        } catch {
          // DOM enrichment is best-effort; keep the structured API result.
        }
      }
    }

    const fullTextLinks = (supplement.fullTextLinks ?? [])
      .map(link => (link.label || '').trim())
      .filter(Boolean)
      .join('; ');
    const fullTextUrls = (supplement.fullTextLinks ?? [])
      .map(link => (link.url || '').trim())
      .filter(Boolean)
      .join('; ');
    const metadata = supplement.metadata ?? {};
    const authorKeywords = extractKeywordGroup(record, 'author_keywords') || metadata.author_keywords || '';
    const keywordsPlus = extractKeywordGroup(record, 'keywords_plus') || metadata.keywords_plus || '';

    const rows = [
      { field: 'title', value: firstTitle(record, 'item') },
      { field: 'authors', value: formatAuthors(record) },
      { field: 'year', value: record.pub_info?.pubyear ?? '' },
      { field: 'source', value: firstTitle(record, 'source') },
      { field: 'doi', value: record.doi ?? '' },
      { field: 'ut', value: record.ut ?? match.record.ut ?? '' },
      { field: 'abstract', value: extractAbstract(record) },
      { field: 'document_type', value: metadata.document_type ?? '' },
      { field: 'article_number', value: metadata.article_number ?? '' },
      { field: 'published', value: metadata.published ?? '' },
      { field: 'early_access', value: metadata.early_access ?? '' },
      { field: 'indexed', value: metadata.indexed ?? '' },
      { field: 'language', value: metadata.language ?? '' },
      { field: 'pubmed_id', value: metadata.pubmed_id ?? '' },
      { field: 'issn', value: metadata.issn ?? '' },
      { field: 'ids_number', value: metadata.ids_number ?? '' },
      { field: 'corresponding_address', value: metadata.corresponding_address ?? '' },
      { field: 'author_addresses', value: metadata.author_addresses ?? '' },
      { field: 'email_addresses', value: metadata.email_addresses ?? '' },
      { field: 'research_areas', value: metadata.research_areas ?? '' },
      { field: 'wos_categories', value: metadata.wos_categories ?? '' },
      { field: 'authors_structured', value: metadata.authors_structured ?? '' },
      { field: 'current_publisher', value: metadata.current_publisher ?? '' },
      { field: 'author_keywords', value: authorKeywords },
      { field: 'keywords_plus', value: keywordsPlus },
      { field: 'citations_woscc', value: String(record.citation_related?.counts?.WOSCC ?? '') },
      { field: 'citations_alldb', value: String(record.citation_related?.counts?.ALLDB ?? '') },
      { field: 'cited_references', value: metadata.cited_references ?? '' },
      { field: 'full_text_links', value: fullTextLinks },
      { field: 'full_text_urls', value: fullTextUrls },
      { field: 'url', value: recordUrl },
    ].filter(row => row.value !== '');

    if (!rows.length) {
      throw new CommandExecutionError(
        'Web of Science record response was empty',
        'Try running the command again or opening the record once in Chrome.',
      );
    }

    return rows;
  },
});
