/**
 * PubMed Search Adapter
 *
 * Search for articles in PubMed using E-utilities ESearch + ESummary APIs.
 * Supports advanced filtering by date, author, journal, article type, etc.
 *
 * API Documentation:
 * - ESearch: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 * - ESummary: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
  eutilsFetch,
  buildSearchQuery,
  extractAuthors,
  extractDoi,
  buildPubMedUrl,
  truncateText,
  formatArticleType,
} from './utils.js';

cli({
  site: 'pubmed',
  name: 'search',
  description: 'Search PubMed articles with advanced filters',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'query',
      type: 'string',
      required: true,
      positional: true,
      help: 'Search query (e.g., "machine learning cancer", "COVID-19 treatment")',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: 'Maximum number of results (max 100)',
    },
    {
      name: 'author',
      type: 'string',
      required: false,
      help: 'Filter by author name',
    },
    {
      name: 'journal',
      type: 'string',
      required: false,
      help: 'Filter by journal name',
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
      name: 'article-type',
      type: 'string',
      required: false,
      help: 'Filter by article type (e.g., "Review", "Clinical Trial", "Meta-Analysis")',
    },
    {
      name: 'has-abstract',
      type: 'boolean',
      default: false,
      help: 'Only include articles with abstracts',
    },
    {
      name: 'free-full-text',
      type: 'boolean',
      default: false,
      help: 'Only include articles with free full text',
    },
    {
      name: 'humans-only',
      type: 'boolean',
      default: false,
      help: 'Only include human studies',
    },
    {
      name: 'english-only',
      type: 'boolean',
      default: false,
      help: 'Only include English articles',
    },
    {
      name: 'sort',
      type: 'string',
      default: 'relevance',
      help: 'Sort by: relevance, date, author, journal',
    },
  ],
  columns: [
    'rank',
    'pmid',
    'title',
    'authors',
    'journal',
    'year',
    'article-type',
    'doi',
    'url',
  ],
  func: async (_page, args) => {
    const limit = Math.min(Math.max(1, Number(args.limit)), 100);

    // Build search query with filters
    const searchQuery = buildSearchQuery(args.query, {
      author: args.author,
      journal: args.journal,
      yearFrom: args['year-from'],
      yearTo: args['year-to'],
      articleType: args['article-type'],
      hasAbstract: args['has-abstract'],
      hasFullText: args['free-full-text'],
      humanOnly: args['humans-only'],
      englishOnly: args['english-only'],
    });

    // Map sort options to E-utilities sort values
    const sortMap: Record<string, string> = {
      relevance: '',
      date: 'pub_date',
      author: 'Author',
      journal: 'JournalName',
    };
    const sort = sortMap[args.sort] || '';

    // Step 1: ESearch - Get PMIDs
    const esearchParams: Record<string, string | number> = {
      term: searchQuery,
      retmax: limit,
      usehistory: 'y',
    };

    if (sort) {
      esearchParams.sort = sort;
    }

    const esearchResult = await eutilsFetch('esearch', esearchParams);

    const pmidList = esearchResult.esearchresult?.idlist;
    if (!pmidList || !Array.isArray(pmidList) || pmidList.length === 0) {
      throw new CliError(
        'NOT_FOUND',
        'No articles found matching your criteria',
        'Try broadening your search terms or removing some filters'
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
      const articleType = formatArticleType(article.pubtype);
      const doi = extractDoi(article.articleids);

      return {
        rank: index + 1,
        pmid,
        title: truncateText(title.replace(/\.$/, ''), 100),
        authors,
        journal: truncateText(journal, 50),
        year,
        'article-type': articleType,
        doi,
        url: buildPubMedUrl(pmid),
      };
    });

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});
