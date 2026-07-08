// rfc rfc — fetch a single IETF RFC's metadata.
//
// Hits `https://datatracker.ietf.org/doc/rfc<N>/doc.json` and projects the
// agent-useful fields: title, abstract (full text — RFCs don't truncate well),
// page count, working group, authors, std level, publish date, plus rendered URLs.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { RFC_BASE, requireRfcNumber, rfcFetch, trimDate } from './utils.js';

cli({
    site: 'rfc',
    name: 'rfc',
    access: 'read',
    description: 'Single IETF RFC metadata (title, abstract, working group, authors, std level)',
    domain: 'datatracker.ietf.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'number', positional: true, type: 'int', required: true, help: 'RFC number (e.g. 9000, 791, 2616)' },
    ],
    columns: [
        'rfc', 'title', 'state', 'stdLevel', 'group', 'groupType',
        'pages', 'published', 'authors', 'abstract', 'rfcEditorUrl', 'url',
    ],
    func: async (args) => {
        const number = requireRfcNumber(args.number);
        const name = `rfc${number}`;
        const doc = await rfcFetch(`${RFC_BASE}/doc/${name}/doc.json`, `rfc ${number}`);
        if (!doc || !doc.name) {
            throw new EmptyResultError('rfc rfc', `IETF datatracker returned no metadata for RFC ${number}.`);
        }
        const authors = Array.isArray(doc.authors)
            ? doc.authors.map((a) => String(a?.name ?? '').trim()).filter(Boolean).join(', ')
            : '';
        const groupName = String(doc.group?.name ?? '').trim();
        const groupType = String(doc.group?.type ?? '').trim();
        return [{
            rfc: number,
            title: String(doc.title ?? '').trim(),
            state: String(doc.state ?? '').trim(),
            stdLevel: String(doc.std_level ?? '').trim(),
            group: groupName,
            groupType,
            pages: doc.pages == null ? null : Number(doc.pages),
            published: trimDate(doc.time),
            authors,
            abstract: String(doc.abstract ?? '').trim(),
            rfcEditorUrl: `https://www.rfc-editor.org/rfc/rfc${number}`,
            url: `${RFC_BASE}/doc/${name}/`,
        }];
    },
});
