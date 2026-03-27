import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import {
  buildExactQuery,
  buildSearchPayload,
  citingSummaryUrl,
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
} from './shared.js';

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
    throw new EmptyResultError('webofscience citing-articles', 'Try using a Web of Science UT or full-record URL.');
  }
  return match.record.ut;
}

cli({
  site: 'webofscience',
  name: 'citing-articles',
  description: 'List articles citing a Web of Science record',
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
    const summaryUrl = citingSummaryUrl(database, ut);
    await page.goto(fullRecordUrl(database, ut), { settleMs: 5000 });
    await page.wait(4);
    await page.evaluate(`(() => { location.href = ${JSON.stringify(summaryUrl)}; return true; })()`);
    const records = fetchCurrentSummaryStreamRecords(page, database, limit, 'citing_article');

    const rows = (await records)
      .slice(0, limit)
      .map((record, index) => ({
        rank: index + 1,
        title: firstTitle(record, 'item'),
        authors: formatAuthors(record),
        year: record.pub_info?.pubyear ?? '',
        source: firstTitle(record, 'source'),
        citations: record.citation_related?.counts?.WOSCC ?? 0,
        doi: record.doi ?? '',
        url: record.ut ? fullRecordUrl(database, record.ut) : '',
      }))
      .filter(row => row.title);

    if (!rows.length) {
      throw new EmptyResultError('webofscience citing-articles', 'Try opening the citing summary in Chrome once, then run again.');
    }

    return rows;
  },
});
