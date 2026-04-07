/**
 * PubMed Author Search Adapter
 *
 * Search for articles by author name and affiliation.
 * Supports searching for first author, last author, or any author position.
 *
 * API Documentation:
 * - ESearch: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 * - ESummary: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
  eutilsFetch,
  extractAuthors,
  extractDoi,
  buildPubMedUrl,
  truncateText,
} from './utils.js';

cli({
  site: 'pubmed',
  name: 'author',
  description: 'Search PubMed articles by author name and affiliation',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'name',
      type: 'string',
      required: true,
      positional: true,
      help: 'Author name (e.g., "Smith J", "Zhang Y", "John Smith")',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: 'Maximum number of results (max 100)',
    },
    {
      name: 'affiliation',
      type: 'string',
      required: false,
      help: 'Filter by author affiliation (e.g., "Harvard", "Stanford", "Beijing")',
    },
    {
      name: 'position',
      type: 'string',
      default: 'any',
      help: 'Author position: any, first, last',
    },
    {
      name: 'year-from',
      type: 'int',
      required: false,
      help: 'Filter: publication year from',
    },
    {
      name: 'year-to',
      type: 'int',
      required: false,
      help: 'Filter: publication year to',
    },
    {
      name: 'sort',
      type: 'string',
      default: 'date',
      help: 'Sort by: date, relevance',
    },
  ],
  columns: [
    'rank',
    'pmid',
    'title',
    'authors',
    'journal',
    'year',
    'doi',
    'url',
  ],
  func: async (_page, args) => {
    const limit = Math.min(Math.max(1, Number(args.limit)), 100);

    // Build author search query
    let authorQuery = args.name;

    // Add position filter
    if (args.position === 'first') {
      authorQuery = `${authorQuery}[1au]`;
    } else if (args.position === 'last') {
      authorQuery = `${authorQuery}[lastau]`;
    } else {
      authorQuery = `${authorQuery}[au]`;
    }

    // Build full query with filters
    const searchTerms: string[] = [authorQuery];

    if (args.affiliation) {
      searchTerms.push(`${args.affiliation}[ad]`);
    }

    if (args['year-from'] || args['year-to']) {
      const from = args['year-from'] || '1900';
      const to = args['year-to'] || new Date().getFullYear();
      searchTerms.push(`${from}:${to}[PDAT]`);
    }

    const searchQuery = searchTerms.join(' AND ');

    // Map sort options
    const sortMap: Record<string, string> = {
      relevance: '',
      date: 'pub_date',
    };
    const sort = sortMap[args.sort] || '';

    // Step 1: ESearch - Get PMIDs
    const esearchParams: Record<string, string | number> = {
      term: searchQuery,
      retmax: limit,
      usehistory: 'y',
      sort,
    };

    const esearchResult = await eutilsFetch('esearch', esearchParams);

    const pmidList = esearchResult.esearchresult?.idlist;
    if (!pmidList || !Array.isArray(pmidList) || pmidList.length === 0) {
      throw new CliError(
        'NOT_FOUND',
        `No articles found for author "${args.name}"`,
        'Try a different name format or remove some filters'
      );
    }

    // Step 2: ESummary - Get article details
    const pmids = pmidList.join(',');
    const esummaryResult = await eutilsFetch('esummary', {
      id: pmids,
    });

    const articles = esummaryResult.result;
    if (!articles || typeof articles !== 'object') {
      throw new CliError(
        'PARSE_ERROR',
        'Failed to parse article data from PubMed',
        'The API response format may have changed'
      );
    }

    // Process results
    const results = pmidList.map((pmid: string, index: number) => {
      const article = articles[pmid];
      if (!article) {
        return null;
      }

      const title = article.title || '';
      const authors = extractAuthors(article.authors, 3);
      const journal = article.fulljournalname || article.source || '';
      const year = article.pubdate?.split(' ')?.[0] || '';
      const doi = extractDoi(article.articleids);

      return {
        rank: index + 1,
        pmid,
        title: truncateText(title.replace(/\.$/, ''), 100),
        authors,
        journal: truncateText(journal, 50),
        year,
        doi,
        url: buildPubMedUrl(pmid),
      };
    });

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});
