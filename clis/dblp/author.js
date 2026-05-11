// dblp author — resolve an author name to a PID and list their publications
// newest first.
//
// Two-step lookup against dblp's public API:
//   1. `search/author/api?q=<name>` returns candidate authors (each with a
//      stable PID URL like `https://dblp.org/pid/56/953`).
//   2. `pid/<pid>.xml` returns every publication under that PID, ordered
//      newest first.
//
// We auto-resolve to the top hit. dblp's author search returns a single
// best-match for unique names; for ambiguous names (e.g. "Wei Wang") it
// returns multiple PIDs — we pick the highest-scored one and surface the
// resolved name + PID in the row metadata so the caller can refine.
//
// To bypass author search entirely, pass `--pid <prefix>/<id>` (e.g.
// `--pid 56/953`). This is the canonical disambiguator.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    DBLP_ORIGIN,
    decodeXmlEntities,
    dblpFetchJson,
    dblpFetchXml,
    extractRecordKey,
    recordXmlToRow,
    requireBoundedInt,
    requireQuery,
} from './utils.js';

const PID_PATTERN = /^[0-9a-z]+(?:\/[0-9a-z-]+)+$/i;

function extractPidFromAuthorHit(hit) {
    const url = String(hit?.info?.url ?? '').trim();
    const m = url.match(/\/pid\/([^/]+(?:\/[^/]+)+)$/);
    return m ? m[1] : '';
}

function pickTopAuthor(hits) {
    // dblp returns hits sorted by score desc; we just take the head.
    return hits[0];
}

function splitRecords(xml) {
    // Each publication is wrapped in <r>…</r> directly under <dblpperson>.
    const out = [];
    const re = /<r>\s*([\s\S]*?)\s*<\/r>/g;
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) {
        const inner = m[1];
        // Skip cross-references that have no concrete record (rare).
        if (/^<crossref/.test(inner)) continue;
        out.push(inner);
    }
    return out;
}

cli({
    site: 'dblp',
    name: 'author',
    access: 'read',
    description: 'List dblp publications by a given author (newest first; resolves to top PID match)',
    domain: 'dblp.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'author', positional: true, required: false, help: 'Author name (e.g. "Yoshua Bengio"). Optional when --pid is given.' },
        { name: 'pid', help: 'Canonical dblp PID (e.g. "56/953"). Bypasses author search.' },
        { name: 'limit', type: 'int', default: 20, help: 'Max publications (1-200)' },
    ],
    columns: ['rank', 'key', 'title', 'authors', 'venue', 'year', 'type', 'doi', 'pid', 'url'],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 200);
        const pidArg = args.pid != null ? String(args.pid).trim() : '';
        let pid = '';
        let resolvedName = '';
        if (pidArg) {
            if (!PID_PATTERN.test(pidArg)) {
                throw new ArgumentError(
                    `dblp pid "${pidArg}" is not a valid PID`,
                    'Expected something like "56/953" — visit the author page on dblp.org to find it.',
                );
            }
            pid = pidArg;
        }
        else {
            const name = requireQuery(args.author, 'author');
            const json = await dblpFetchJson(
                `/search/author/api?q=${encodeURIComponent(name)}&format=json&h=20`,
                'dblp author search',
            );
            const raw = json?.result?.hits?.hit;
            const hits = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            if (!hits.length) {
                throw new EmptyResultError(
                    'dblp author',
                    `No dblp author matched "${name}". Try a different spelling, or pass --pid to bypass author search.`,
                );
            }
            const top = pickTopAuthor(hits);
            pid = extractPidFromAuthorHit(top);
            if (!pid) {
                throw new CommandExecutionError(
                    `dblp author search for "${name}" returned a hit without a PID URL`,
                    'dblp may have changed its author-search response shape; retry or pass --pid manually.',
                );
            }
            resolvedName = decodeXmlEntities(String(top?.info?.author ?? '')).trim();
        }
        const xml = await dblpFetchXml(`/pid/${pid}.xml`, `dblp pid ${pid}`);
        const records = splitRecords(xml);
        if (!records.length) {
            throw new EmptyResultError(
                'dblp author',
                `dblp PID ${pid}${resolvedName ? ` (${resolvedName})` : ''} has no publications.`,
            );
        }
        return records.slice(0, limit).map((recordXml, i) => {
            const row = recordXmlToRow(`<root>${recordXml}</root>`);
            return {
                rank: i + 1,
                key: row.key || extractRecordKey(recordXml),
                title: row.title,
                authors: row.authors,
                venue: row.venue,
                year: row.year,
                type: row.type,
                doi: row.doi,
                pid,
                url: row.open_access_url || row.dblp_url,
            };
        });
    },
});
