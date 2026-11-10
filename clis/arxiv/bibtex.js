// arxiv bibtex — export the citation record arXiv itself renders for a paper.
//
// Why this exists: OpenCLI already exposes search/recent/paper/author, but every
// downstream consumer that needs to cite a paper still has to hand-build BibTeX
// from those fields. arXiv publishes an authoritative record at
// https://arxiv.org/bibtex/<id>; this command returns it verbatim, plus the
// parsed fields an agent can branch on without re-implementing a BibTeX parser.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { fetchArxivBibtex, normalizeArxivId, parseBibtexEntry } from './utils.js';

cli({
    site: 'arxiv',
    name: 'bibtex',
    access: 'read',
    description: 'Get the BibTeX citation record for an arXiv paper',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'arXiv paper ID (e.g. 1706.03762 or 1706.03762v7)' },
    ],
    columns: ['id', 'cite_key', 'title', 'authors', 'year', 'primary_class', 'bibtex', 'url'],
    func: async (args) => {
        const id = normalizeArxivId(args.id);
        const record = await fetchArxivBibtex(id);
        const parsed = parseBibtexEntry(record.bibtex);
        if (!parsed) {
            throw new CommandExecutionError('Could not parse the BibTeX record arXiv returned for ' + id + '. Re-run with --trace on to inspect the raw payload.');
        }
        const fields = parsed.fields;
        const eprint = fields.eprint || id;
        return [{
            id: eprint,
            cite_key: parsed.citeKey,
            title: fields.title || '',
            authors: fields.author || '',
            year: fields.year || '',
            primary_class: fields.primaryclass || '',
            bibtex: record.bibtex,
            url: fields.url || ('https://arxiv.org/abs/' + eprint),
        }];
    },
});
