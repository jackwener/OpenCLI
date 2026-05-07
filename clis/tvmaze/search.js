// tvmaze search — TV show search by title.
//
// Hits `https://api.tvmaze.com/search/shows?q=<query>` and returns one row per
// match. Includes the show id (round-tripable into `tvmaze show <id>`),
// premiered/ended dates, network, and TVmaze rating so agents can rank.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    TVMAZE_BASE, joinList, requireBoundedInt, requireString, stripHtml, tvmazeFetch,
} from './utils.js';

cli({
    site: 'tvmaze',
    name: 'search',
    access: 'read',
    description: 'TVmaze TV show search by title (returns id, name, network, premiered/ended, rating)',
    domain: 'tvmaze.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, type: 'string', required: true, help: 'TV show title or fragment to search for' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-50)' },
    ],
    columns: [
        'rank', 'id', 'name', 'type', 'language', 'genres',
        'status', 'premiered', 'ended', 'network', 'rating',
        'matchScore', 'summary', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 50, 'limit');
        const list = await tvmazeFetch(
            `${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(query)}`,
            `tvmaze search ${query}`,
        );
        if (!Array.isArray(list) || list.length === 0) {
            throw new EmptyResultError('tvmaze search', `TVmaze returned no shows matching "${query}".`);
        }
        const rows = list.slice(0, limit).map((entry, i) => {
            const show = entry?.show ?? {};
            const network = show.network?.name ?? show.webChannel?.name ?? '';
            return {
                rank: i + 1,
                id: typeof show.id === 'number' ? show.id : null,
                name: String(show.name ?? '').trim(),
                type: String(show.type ?? '').trim(),
                language: String(show.language ?? '').trim(),
                genres: joinList(show.genres),
                status: String(show.status ?? '').trim(),
                premiered: typeof show.premiered === 'string' ? show.premiered : null,
                ended: typeof show.ended === 'string' ? show.ended : null,
                network: String(network).trim(),
                rating: show.rating?.average == null ? null : Number(show.rating.average),
                matchScore: typeof entry?.score === 'number' ? entry.score : null,
                summary: stripHtml(show.summary),
                url: String(show.url ?? '').trim(),
            };
        });
        return rows;
    },
});
