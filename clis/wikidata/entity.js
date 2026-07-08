// wikidata entity — fetch a single Wikidata entity by Q/P/L identifier.
//
// Hits `Special:EntityData/<id>.json`, the canonical public dump. Surfaces the
// agent-useful projection: localised label/description/aliases plus high-level
// counts (claim properties, sitelinks). The full claim graph is huge; we keep
// the projection narrow by design.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { WIKIDATA_BASE, joinAliases, pickLocalised, requireEntityId, requireLanguage, wikidataFetch } from './utils.js';

cli({
    site: 'wikidata',
    name: 'entity',
    access: 'read',
    description: 'Fetch a Wikidata entity by Q/P/L id (label, description, aliases, claim summary)',
    domain: 'www.wikidata.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Entity id (e.g. Q937 = Albert Einstein, P31 = instance of)' },
        { name: 'language', default: 'en', help: 'Display language (ISO 639, falls back to English when missing)' },
    ],
    columns: [
        'qid',
        'type',
        'label',
        'description',
        'aliases',
        'claimPropertyCount',
        'sitelinkCount',
        'enwikiTitle',
        'modified',
        'url',
    ],
    func: async (args) => {
        const qid = requireEntityId(args.id);
        const language = requireLanguage(args.language);
        const url = `${WIKIDATA_BASE}/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`;
        const body = await wikidataFetch(url, 'wikidata entity');
        const entity = body?.entities?.[qid];
        if (!entity) {
            throw new EmptyResultError('wikidata entity', `Wikidata entity ${qid} returned no payload.`);
        }
        const claims = entity.claims && typeof entity.claims === 'object' ? entity.claims : {};
        const sitelinks = entity.sitelinks && typeof entity.sitelinks === 'object' ? entity.sitelinks : {};
        const enwiki = sitelinks?.enwiki?.title;
        return [{
            qid,
            type: typeof entity.type === 'string' ? entity.type : null,
            label: pickLocalised(entity.labels, language),
            description: pickLocalised(entity.descriptions, language),
            aliases: joinAliases(entity.aliases, language),
            claimPropertyCount: Object.keys(claims).length,
            sitelinkCount: Object.keys(sitelinks).length,
            enwikiTitle: typeof enwiki === 'string' && enwiki.trim() ? enwiki : null,
            modified: typeof entity.modified === 'string' ? entity.modified : null,
            url: `${WIKIDATA_BASE}/wiki/${qid}`,
        }];
    },
});
