/**
 * OpenReview full-text search.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { noteToRow, openreviewFetch, requireBoundedInt } from './utils.js';

cli({
    site: 'openreview',
    name: 'search',
    access: 'read',
    description: 'Search OpenReview papers by free-text query',
    domain: 'openreview.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "diffusion model")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max results (max 50)' },
    ],
    columns: ['rank', 'id', 'title', 'authors', 'venue', 'pdate', 'url'],
    func: async (args) => {
        const term = String(args.query ?? '').trim();
        if (!term) {
            throw new ArgumentError('openreview search query cannot be empty');
        }
        const limit = requireBoundedInt(args.limit, 25, 50);
        const path = `/notes/search?term=${encodeURIComponent(term)}&type=terms&limit=${limit}`;
        const json = await openreviewFetch(path, 'openreview search');
        const notes = Array.isArray(json?.notes) ? json.notes : [];
        if (!notes.length) {
            throw new EmptyResultError('openreview', `No papers found for "${term}". Try a different keyword.`);
        }
        return notes.slice(0, limit).map((note, i) => {
            const row = noteToRow(note);
            return {
                rank: i + 1,
                id: row.id,
                title: row.title,
                authors: row.authors,
                venue: row.venue,
                pdate: row.pdate,
                url: row.url,
            };
        });
    },
});
