// rickandmorty character — character listing with optional --name / --status / --species filters.
//
// Endpoint: GET /character/?page=N&name=&status=&species=
// Pagination: server-fixed 20/page; we walk pages until we hit --limit.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { paginate, requireBoundedInt, RM_BASE } from './utils.js';

cli({
    site: 'rickandmorty',
    name: 'character',
    access: 'read',
    description: 'Search Rick and Morty characters by name / status / species',
    domain: 'rickandmortyapi.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-100, default 20)' },
        { name: 'name', help: 'Filter by name substring (case-insensitive)' },
        { name: 'status', help: 'alive | dead | unknown' },
        { name: 'species', help: 'Species filter (e.g. Human, Alien, Robot)' },
    ],
    columns: [
        'rank', 'id', 'name', 'status', 'species', 'type', 'gender',
        'origin', 'location', 'episodes', 'image', 'created', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 100);
        const params = new URLSearchParams();
        if (args.name) params.set('name', String(args.name));
        if (args.status) params.set('status', String(args.status));
        if (args.species) params.set('species', String(args.species));
        const qs = params.toString();
        const url = `${RM_BASE}/character/${qs ? `?${qs}` : ''}`;
        const list = await paginate(url, limit, 'rickandmorty character');
        if (!list.length) {
            throw new EmptyResultError('rickandmorty character', 'rickandmortyapi.com returned no characters.');
        }
        return list.map((c, i) => ({
            rank: i + 1,
            id: c?.id ?? null,
            name: c?.name ?? null,
            status: c?.status ?? null,
            species: c?.species ?? null,
            type: c?.type ? c.type : null, // explicit `null` not `''` for missing
            gender: c?.gender ?? null,
            origin: c?.origin?.name ?? null,
            location: c?.location?.name ?? null,
            episodes: Array.isArray(c?.episode) ? c.episode.length : null,
            image: c?.image ?? null,
            created: c?.created ?? null,
            url: c?.url ?? null,
        }));
    },
});
