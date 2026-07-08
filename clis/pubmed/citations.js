import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LINK_COLUMNS, eutilsFetch, fetchSummaryRows, requireBoundedInt, requireChoice, requirePmid } from './utils.js';

cli({
    site: 'pubmed',
    name: 'citations',
    access: 'read',
    description: 'Get PubMed citation relationships for an article',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'pmid', positional: true, required: true, help: 'PubMed ID, e.g. 37780221' },
        { name: 'direction', default: 'citedby', choices: ['citedby', 'references'], help: 'citedby or references' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
    ],
    columns: LINK_COLUMNS,
    func: async (args) => {
        const pmid = requirePmid(args.pmid);
        const direction = requireChoice(args.direction, ['citedby', 'references'], 'direction', 'citedby');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const linkname = direction === 'citedby' ? 'pubmed_pubmed_citedin' : 'pubmed_pubmed_refs';
        const result = await eutilsFetch('elink', {
            id: pmid,
            dbfrom: 'pubmed',
            cmd: 'neighbor',
            linkname,
        }, { label: 'pubmed citations' });
        const links = result?.linksets?.[0]?.linksetdbs?.[0]?.links;
        if (!Array.isArray(links) || links.length === 0) {
            throw new EmptyResultError('pubmed citations', `No ${direction} links found for PMID ${pmid}.`);
        }
        return fetchSummaryRows(links.slice(0, limit).map(String), 'pubmed citations summary');
    },
});
