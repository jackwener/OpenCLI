// rickandmorty episode — episode listing with optional --name / --episode (S01E01 code).
//
// Endpoint: GET /episode/?page=N&name=&episode=
// `episode` field on each row is the production code (S01E01); `name` is the title.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { paginate, requireBoundedInt, RM_BASE } from './utils.js';

cli({
    site: 'rickandmorty',
    name: 'episode',
    access: 'read',
    description: 'List Rick and Morty episodes (filter by name or season/episode code)',
    domain: 'rickandmortyapi.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-100, default 20)' },
        { name: 'name', help: 'Filter by episode title substring' },
        { name: 'episode', help: 'Filter by production code (e.g. S01, S01E01)' },
    ],
    columns: [
        'rank', 'id', 'name', 'airDate', 'episodeCode', 'characters', 'created', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 100);
        const params = new URLSearchParams();
        if (args.name) params.set('name', String(args.name));
        if (args.episode) params.set('episode', String(args.episode));
        const qs = params.toString();
        const url = `${RM_BASE}/episode/${qs ? `?${qs}` : ''}`;
        const list = await paginate(url, limit, 'rickandmorty episode');
        if (!list.length) {
            throw new EmptyResultError('rickandmorty episode', 'rickandmortyapi.com returned no episodes.');
        }
        return list.map((e, i) => ({
            rank: i + 1,
            id: e?.id ?? null,
            name: e?.name ?? null,
            airDate: e?.air_date ?? null,
            episodeCode: e?.episode ?? null,
            characters: Array.isArray(e?.characters) ? e.characters.length : null,
            created: e?.created ?? null,
            url: e?.url ?? null,
        }));
    },
});
