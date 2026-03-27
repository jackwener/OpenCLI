import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import {
  basicSearchUrl,
  buildBasicSearchRowText,
  buildSearchPayload,
  clampLimit,
  ensureSearchSessionAtUrl,
  extractRecords,
  firstTitle,
  formatAuthors,
  fullRecordUrl,
  listBasicSearchFields,
  normalizeDatabase,
  normalizeBasicSearchField,
} from './shared.js';

const BASIC_SEARCH_INPUT_SELECTOR = '#search-option-0';

cli({
  site: 'webofscience',
  name: 'basic-search',
  description: 'Search Web of Science via the Basic Search page',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query' },
    { name: 'field', required: false, help: 'Basic Search field', choices: listBasicSearchFields().map(field => field.aliases[0]) },
    { name: 'database', required: false, help: 'Database to search', choices: ['woscc', 'alldb'] },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (max 50)' },
  ],
  columns: ['rank', 'title', 'authors', 'year', 'source', 'citations', 'doi', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) {
      throw new ArgumentError('Search query is required');
    }

    const database = normalizeDatabase(kwargs.database);
    const limit = clampLimit(kwargs.limit);
    const field = normalizeBasicSearchField(kwargs.field);
    const sid = await ensureSearchSessionAtUrl(page, basicSearchUrl(database), query, BASIC_SEARCH_INPUT_SELECTOR);
    const payload = buildSearchPayload(query, limit, database, buildBasicSearchRowText(query, field.key));

    const events = await page.evaluate(`(async () => {
      const payload = ${JSON.stringify(payload)};
      const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    })()`);

    const records = extractRecords(events)
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
      .filter(record => record.title);

    if (!records.length) {
      throw new EmptyResultError('webofscience basic-search', 'Try a different keyword or verify your Web of Science access in Chrome');
    }

    return records;
  },
});
