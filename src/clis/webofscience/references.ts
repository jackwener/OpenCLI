import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import {
  buildExactQuery,
  buildSearchPayload,
  citedReferencesSummaryUrl,
  clampLimit,
  ensureSearchSession,
  extractRecords,
  fetchCurrentSummaryStreamRecords,
  findMatchingRecord,
  firstTitle,
  formatAuthors,
  fullRecordUrl,
  normalizeDatabase,
  parseRecordIdentifier,
  type WosRecord,
} from './shared.js';

function referenceTitle(record: WosRecord): string {
  return firstTitle(record, 'item') || firstTitle(record, 'source');
}

function referenceUrl(database: 'woscc' | 'alldb', record: WosRecord): string {
  return /^WOS:/i.test(String(record.ut || '')) ? fullRecordUrl(database, String(record.ut)) : '';
}

async function resolveUt(
  page: {
    evaluate: (js: string) => Promise<any>;
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    typeText: (selector: string, text: string) => Promise<any>;
    click: (selector: string) => Promise<any>;
    pressKey: (key: string) => Promise<any>;
  },
  rawId: string,
  database: 'woscc' | 'alldb',
): Promise<string> {
  const identifier = parseRecordIdentifier(rawId);
  if (!identifier) {
    throw new ArgumentError('Record identifier must be a Web of Science UT, DOI, or full-record URL');
  }
  if (identifier.kind === 'ut') return identifier.value;

  const sid = await ensureSearchSession(page, database, rawId);
  const events = await page.evaluate(`(async () => {
    const payload = ${JSON.stringify(buildSearchPayload(rawId, 5, database, buildExactQuery(identifier)))};
    const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  })()`);
  const match = findMatchingRecord(extractRecords(events), identifier);
  if (!match?.record?.ut) {
    throw new EmptyResultError('webofscience references', 'Try using a Web of Science UT or full-record URL.');
  }
  return match.record.ut;
}

cli({
  site: 'webofscience',
  name: 'references',
  description: 'List cited references for a Web of Science record',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'Web of Science UT, DOI, or full-record URL' },
    { name: 'database', required: false, help: 'Database to use', choices: ['woscc', 'alldb'] },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (max 50)' },
  ],
  columns: ['rank', 'title', 'authors', 'year', 'source', 'citations', 'doi', 'url'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? '').trim();
    if (!rawId) throw new ArgumentError('Record identifier is required');

    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError('Record identifier must be a Web of Science UT, DOI, or full-record URL');
    }

    const database = normalizeDatabase(kwargs.database, identifier.database ?? 'woscc');
    const limit = clampLimit(kwargs.limit);
    const ut = await resolveUt(page, rawId, database);
    const summaryUrl = citedReferencesSummaryUrl(database, ut);
    await page.goto(fullRecordUrl(database, ut), { settleMs: 5000 });
    await page.wait(4);
    await page.evaluate(`(() => { location.href = ${JSON.stringify(summaryUrl)}; return true; })()`);
    const records = await fetchCurrentSummaryStreamRecords(page, database, limit, 'cited_references');

    const rows = records
      .slice(0, limit)
      .map((record, index) => ({
        rank: index + 1,
        title: referenceTitle(record),
        authors: formatAuthors(record),
        year: record.pub_info?.pubyear ?? '',
        source: firstTitle(record, 'source'),
        citations: record.citation_related?.counts?.WOSCC ?? 0,
        doi: record.doi ?? '',
        url: referenceUrl(database, record),
      }))
      .filter(row => row.title);

    if (!rows.length) {
      throw new EmptyResultError('webofscience references', 'Try opening the cited references summary in Chrome once, then run again.');
    }

    return rows;
  },
});
