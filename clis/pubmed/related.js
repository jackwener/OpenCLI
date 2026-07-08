import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { RELATED_COLUMNS, eutilsFetch, fetchSummaryRows, requireBoundedInt, requirePmid } from './utils.js';

cli({
    site: 'pubmed',
    name: 'related',
    access: 'read',
    description: 'Find articles related to a PubMed article',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'pmid', positional: true, required: true, help: 'PubMed ID, e.g. 37780221' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'score', type: 'boolean', default: false, help: 'Show similarity scores when available' },
    ],
    columns: RELATED_COLUMNS,
    func: async (args) => {
        const pmid = requirePmid(args.pmid);
        const limit = requireBoundedInt(args.limit, 20, 100);
        const result = await eutilsFetch('elink', {
            id: pmid,
            dbfrom: 'pubmed',
            cmd: 'neighbor_score',
            linkname: 'pubmed_pubmed',
        }, { label: 'pubmed related' });
        const rawLinks = result?.linksets?.[0]?.linksetdbs?.[0]?.links;
        if (!Array.isArray(rawLinks) || rawLinks.length === 0) {
            throw new EmptyResultError('pubmed related', `No related articles found for PMID ${pmid}.`);
        }
        const links = rawLinks
            .map(link => typeof link === 'string' ? { id: link, score: null } : { id: String(link?.id ?? ''), score: Number.isFinite(Number(link?.score)) ? Number(link.score) : null })
            .filter(link => link.id && link.id !== pmid)
            .slice(0, limit);
        if (links.length === 0) {
            throw new EmptyResultError('pubmed related', `No related articles found for PMID ${pmid}.`);
        }
        const rows = await fetchSummaryRows(links.map(link => link.id), 'pubmed related summary');
        return rows.map((row, index) => ({
            ...row,
            score: args.score ? links[index].score : null,
        }));
    },
});
