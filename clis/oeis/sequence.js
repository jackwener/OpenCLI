// oeis sequence — full detail for a single OEIS sequence (A-number).
//
// OEIS' search endpoint, when given `q=id:Annnnnn`, returns one full record
// with all sub-fields populated. We surface formula / xref / reference counts
// instead of dumping the full graph.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OEIS_BASE, formatId, oeisFetch, previewTerms, requireSequenceId } from './utils.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

cli({
    site: 'oeis',
    name: 'sequence',
    access: 'read',
    description: 'Full OEIS sequence detail by A-number (terms, name, keywords, formula counts)',
    domain: 'oeis.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'OEIS sequence id (e.g. "A000045" for Fibonacci)' },
    ],
    columns: [
        'id',
        'name',
        'keywords',
        'preview',
        'termCount',
        'offset',
        'author',
        'created',
        'revision',
        'commentCount',
        'formulaCount',
        'referenceCount',
        'xrefCount',
        'linkCount',
        'url',
    ],
    func: async (args) => {
        const id = requireSequenceId(args.id);
        const url = `${OEIS_BASE}/search?q=id:${encodeURIComponent(id)}&fmt=json`;
        const body = await oeisFetch(url, 'oeis sequence');
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('oeis sequence', `OEIS sequence "${id}" not found.`);
        }
        const r = list[0];
        const data = typeof r?.data === 'string' ? r.data : '';
        const termCount = data ? data.split(',').filter(Boolean).length : 0;
        return [{
            id: formatId(r?.number) ?? id,
            name: typeof r?.name === 'string' ? r.name : null,
            keywords: typeof r?.keyword === 'string' ? r.keyword : null,
            preview: previewTerms(data),
            termCount,
            offset: typeof r?.offset === 'string' ? r.offset : null,
            author: typeof r?.author === 'string' ? r.author : null,
            created: typeof r?.created === 'string' ? r.created : null,
            revision: typeof r?.revision === 'number' ? r.revision : null,
            commentCount: asArray(r?.comment).length,
            formulaCount: asArray(r?.formula).length,
            referenceCount: asArray(r?.reference).length,
            xrefCount: asArray(r?.xref).length,
            linkCount: asArray(r?.link).length,
            url: `${OEIS_BASE}/${formatId(r?.number) ?? id}`,
        }];
    },
});
