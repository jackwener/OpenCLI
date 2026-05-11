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
    args: [
        { name: 'pmid', positional: true, required: true, help: 'PubMed ID, e.g. 37780221' },
        { name: 'full-abstract', type: 'boolean', default: false, help: 'Do not truncate the abstract in table output' },
    ],
    columns: ['field', 'value'],
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
            { field: 'PMID', value: article.pmid },
            { field: 'Title', value: article.title },
            { field: 'Authors', value: article.authors.join(', ') },
            { field: 'Journal', value: article.journal },
            { field: 'Year', value: article.year },
            { field: 'Date', value: article.date },
            { field: 'Article Type', value: article.article_type },
            { field: 'Language', value: article.language },
            { field: 'DOI', value: article.doi || null },
            { field: 'PMC ID', value: article.pmc || null },
            { field: 'MeSH Terms', value: article.mesh_terms || null },
            { field: 'Keywords', value: article.keywords || null },
            { field: 'Abstract', value: abstract || null },
            { field: 'URL', value: article.url },
        ];
    },
});
