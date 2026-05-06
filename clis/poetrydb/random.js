// poetrydb random — fetch one or more random poems from PoetryDB.
//
// Endpoint: GET /random/<count>
//
// Returns N random poems. Useful for daily-poem prompts or filling
// caches; pair with `poetrydb search --title <title>` to round-trip
// back to a specific poem.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    POETRYDB_BASE,
    isPoetryDbNotFound,
    poetrydbFetch,
    projectPoem,
    requireBoundedInt,
} from './utils.js';

cli({
    site: 'poetrydb',
    name: 'random',
    access: 'read',
    description: 'Fetch random poems from PoetryDB',
    domain: 'poetrydb.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'count', type: 'int', default: 1, help: 'How many random poems (1-50, default 1)' },
    ],
    columns: ['rank', 'title', 'author', 'lineCount', 'firstLine', 'lastLine', 'text', 'url'],
    func: async (args) => {
        const count = requireBoundedInt(args.count, 1, 50, 'count');
        const url = `${POETRYDB_BASE}/random/${count}`;
        const body = await poetrydbFetch(url, 'poetrydb random');
        if (isPoetryDbNotFound(body)) {
            throw new EmptyResultError('poetrydb random', 'PoetryDB returned no random poem.');
        }
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('poetrydb random', 'PoetryDB returned an empty random selection.');
        }
        return list.map((p, i) => ({
            rank: i + 1,
            ...projectPoem(p),
        }));
    },
});
