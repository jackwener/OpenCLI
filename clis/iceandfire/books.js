// iceandfire books — ASOIAF books listing.
//
// Endpoint: GET /books?page=N&pageSize=M&name=&fromReleaseDate=&toReleaseDate=
// API returns rich book metadata + URL-only references to characters / POVs.
// We expose `charactersCount` / `povCharactersCount` derived from array length
// (counts are useful, raw URL arrays would explode column shape).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { paginate, requireBoundedInt, urlToId, IAF_BASE } from './utils.js';

cli({
    site: 'iceandfire',
    name: 'books',
    access: 'read',
    description: 'Game of Thrones / ASOIAF books (filter by name + release date)',
    domain: 'anapioficeandfire.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-200, default 20)' },
        { name: 'name', help: 'Filter by book name substring' },
        { name: 'from-release-date', help: 'ISO 8601 lower bound (e.g. 1996-01-01)' },
        { name: 'to-release-date', help: 'ISO 8601 upper bound (e.g. 2025-12-31)' },
    ],
    columns: [
        'rank', 'id', 'name', 'isbn', 'authors', 'numberOfPages', 'publisher',
        'country', 'mediaType', 'released', 'charactersCount', 'povCharactersCount', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 200);
        const list = await paginate(`${IAF_BASE}/books`, limit, {
            name: args.name,
            fromReleaseDate: args['from-release-date'],
            toReleaseDate: args['to-release-date'],
        }, 'iceandfire books');
        if (!list.length) {
            throw new EmptyResultError('iceandfire books', 'anapioficeandfire.com returned no books for these filters.');
        }
        return list.map((b, i) => ({
            rank: i + 1,
            id: urlToId(b?.url),
            name: b?.name ?? null,
            isbn: b?.isbn ?? null,
            authors: Array.isArray(b?.authors) ? b.authors.join(', ') : null,
            numberOfPages: b?.numberOfPages ?? null,
            publisher: b?.publisher ?? null,
            country: b?.country ?? null,
            mediaType: b?.mediaType ?? null,
            released: b?.released ?? null,
            charactersCount: Array.isArray(b?.characters) ? b.characters.length : null,
            povCharactersCount: Array.isArray(b?.povCharacters) ? b.povCharacters.length : null,
            url: b?.url ?? null,
        }));
    },
});
