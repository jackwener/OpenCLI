import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { eutilsFetch, parseArticleXml, requirePmid, truncateText } from './utils.js';

cli({
    site: 'pubmed',
    name: 'article',
    aliases: ['paper', 'read'],
    access: 'read',
    description: 'Get detailed information for a PubMed article by PMID',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    defaultFormat: 'plain',
    args: [
        { name: 'pmid', positional: true, required: true, help: 'PubMed ID, e.g. 37780221' },
        { name: 'full-abstract', type: 'boolean', default: false, help: 'Do not truncate the abstract in table output' },
    ],
    columns: ['pmid', 'title', 'authors', 'journal', 'year', 'date', 'article_type', 'language', 'doi', 'pmc', 'affiliations', 'grants', 'mesh_terms', 'keywords', 'abstract', 'url'],
    func: async (args) => {
        const pmid = requirePmid(args.pmid);
        const xml = await eutilsFetch('efetch', {
            id: pmid,
            rettype: 'abstract',
        }, { retmode: 'xml', label: 'pubmed article' });
        const article = parseArticleXml(xml, pmid);
        if (!article) {
            throw new EmptyResultError('pubmed article', `No article found for PMID ${pmid}.`);
        }
        if (!article.title) {
            throw new CommandExecutionError(`pubmed article ${pmid} did not include a title`, 'PubMed EFetch response shape may have changed.');
        }
        const abstract = args['full-abstract'] ? article.abstract : truncateText(article.abstract, 500);
        return [
            {
                pmid: article.pmid,
                title: article.title,
                authors: article.authors.join(', '),
                journal: article.journal,
                year: article.year,
                date: article.date || null,
                article_type: article.article_type,
                language: article.language || null,
                doi: article.doi || null,
                pmc: article.pmc || null,
                affiliations: article.affiliations || null,
                grants: article.grants || null,
                mesh_terms: article.mesh_terms || null,
                keywords: article.keywords || null,
                abstract: abstract || null,
                url: article.url,
            },
        ];
    },
});
