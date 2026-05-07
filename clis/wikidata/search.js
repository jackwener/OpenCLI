// wikidata search — find Wikidata entities (items) by keyword.
//
// Hits `wbsearchentities` on the public MediaWiki API. Returns Q-IDs that
// round-trip into `wikidata entity` for full detail.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { WIKIDATA_BASE, requireBoundedInt, requireLanguage, requireString, wikidataFetch } from './utils.js';

cli({
    site: 'wikidata',
    name: 'search',
    access: 'read',
    description: 'Search Wikidata items by keyword (returns Q-IDs)',
    domain: 'www.wikidata.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (label / alias)' },
        { name: 'language', default: 'en', help: 'Search & display language (ISO 639, e.g. en, fr, zh)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max items (1-50)' },
    ],
    columns: ['rank', 'qid', 'label', 'description', 'matchType', 'matchText', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const language = requireLanguage(args.language);
        const limit = requireBoundedInt(args.limit, 20, 50);
        const url = `${WIKIDATA_BASE}/w/api.php?action=wbsearchentities`
            + `&search=${encodeURIComponent(query)}`
            + `&language=${encodeURIComponent(language)}`
            + `&uselang=${encodeURIComponent(language)}`
            + `&type=item&format=json&limit=${limit}&origin=*`;
        const body = await wikidataFetch(url, 'wikidata search');
        const list = Array.isArray(body?.search) ? body.search : [];
        if (!list.length) {
            throw new EmptyResultError('wikidata search', `No Wikidata items matched "${query}" in language "${language}".`);
        }
        return list.slice(0, limit).map((item, i) => {
            const qid = String(item?.id ?? '').trim();
            return {
                rank: i + 1,
                qid,
                label: typeof item?.label === 'string' ? item.label : null,
                description: typeof item?.description === 'string' ? item.description : null,
                matchType: typeof item?.match?.type === 'string' ? item.match.type : null,
                matchText: typeof item?.match?.text === 'string' ? item.match.text : null,
                url: qid ? `${WIKIDATA_BASE}/wiki/${qid}` : '',
            };
        });
    },
});
