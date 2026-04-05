/**
 * PubMed Article Details Adapter
 *
 * Get detailed information about a specific PubMed article by PMID.
 * Uses ESummary API to retrieve metadata (ESummary returns JSON, EFetch returns XML).
 *
 * API Documentation:
 * - ESummary: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
  eutilsFetch,
  extractAuthors,
  extractFirstAuthor,
  extractCorrespondingAuthor,
  extractDoi,
  extractPmcId,
  buildPubMedUrl,
  truncateText,
  formatArticleType,
} from './utils.js';

cli({
  site: 'pubmed',
  name: 'article',
  description: 'Get detailed information about a PubMed article by PMID',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'pmid',
      type: 'string',
      required: true,
      positional: true,
      help: 'PubMed ID (e.g., "37780221", "37158692")',
    },
    {
      name: 'output',
      type: 'string',
      default: 'table',
      help: 'Output format: table (summary) or json (full details)',
    },
  ],
  columns: [
    'field',
    'value',
  ],
  func: async (_page, args) => {
    const pmid = args.pmid.trim();

    // Validate PMID format
    if (!/^\d+$/.test(pmid)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `Invalid PMID format: ${pmid}`,
        'PMID should be a numeric string (e.g., "37780221")'
      );
    }

    // Use ESummary to get article details (returns JSON, unlike EFetch which returns XML)
    const esummaryResult = await eutilsFetch('esummary', {
      id: pmid,
    });

    const article = esummaryResult.result?.[pmid];
    if (!article) {
      throw new CliError(
        'NOT_FOUND',
        `Article with PMID ${pmid} not found`,
        'Check the PMID and try again'
      );
    }

    // Extract basic info
    const title = article.title || '';
    const abstract = article.abstract || '';
    const abstractText = typeof abstract === 'string' ? abstract : '';

    // Extract authors
    const authorList = article.authors || [];
    const allAuthors = extractAuthors(authorList, 10);
    const firstAuthor = extractFirstAuthor(authorList);
    const correspondingAuthor = extractCorrespondingAuthor(authorList);

    // Extract journal info
    const journalTitle = article.fulljournalname || article.source || '';
    const isoAbbreviation = article.source || '';

    // Extract publication date
    const pubDate = article.pubdate || '';
    const year = pubDate.split(' ')[0] || '';
    const fullDate = pubDate;

    // Extract volume, issue, pages
    const volume = article.volume || '';
    const issue = article.issue || '';
    const pagination = article.pages || '';

    // Extract article IDs
    const articleIds = article.articleids || [];
    const doi = extractDoi(articleIds);
    const pmcId = extractPmcId(articleIds);

    // Extract MeSH terms and keywords (from ESummary these may not be available)
    const meshTerms: string[] = [];
    const keywords: string[] = [];

    // Extract article type
    const pubTypeList = article.pubtype || [];
    const articleType = formatArticleType(pubTypeList);

    // Extract language
    const language = article.lang?.[0] || '';

    // If JSON format requested, return full structured data
    if (args.output === 'json') {
      return [{
        field: 'data',
        value: JSON.stringify({
          pmid,
          title,
          abstract: abstractText,
          authors: {
            all: allAuthors,
            first: firstAuthor,
            corresponding: correspondingAuthor,
            count: authorList?.length || 0,
          },
          journal: {
            title: journalTitle,
            isoAbbreviation,
            volume,
            issue,
            pagination,
          },
          publication: {
            year,
            fullDate,
          },
          ids: {
            pmid,
            doi,
            pmc: pmcId,
          },
          classification: {
            articleType,
            language,
            meshTerms,
            keywords,
          },
          url: buildPubMedUrl(pmid),
        }, null, 2),
      }];
    }

    // Table format - return key-value pairs
    const rows: Array<{ field: string; value: string }> = [
      { field: 'PMID', value: pmid },
      { field: 'Title', value: title },
      { field: 'First Author', value: firstAuthor },
      { field: 'Corresponding Author', value: correspondingAuthor },
      { field: 'All Authors', value: truncateText(allAuthors, 100) },
      { field: 'Journal', value: journalTitle },
      { field: 'Year', value: year },
      { field: 'Volume/Issue', value: `${volume}${issue ? `(${issue})` : ''}` },
      { field: 'Pages', value: pagination },
      { field: 'DOI', value: doi || 'N/A' },
      { field: 'PMC ID', value: pmcId || 'N/A' },
      { field: 'Article Type', value: articleType },
      { field: 'Language', value: language },
      { field: 'MeSH Terms', value: meshTerms.join(', ') || 'N/A' },
      { field: 'Keywords', value: keywords.join(', ') || 'N/A' },
      { field: 'Abstract', value: truncateText(abstractText, 300) || 'N/A' },
      { field: 'URL', value: buildPubMedUrl(pmid) },
    ];



    return rows;
  },
});
