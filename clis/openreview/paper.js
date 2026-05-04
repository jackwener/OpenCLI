/**
 * OpenReview single paper detail (full abstract + metadata).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { noteToRow, openreviewFetch, requireForumId } from './utils.js';

cli({
    site: 'openreview',
    name: 'paper',
    access: 'read',
    description: 'Show full metadata for a single OpenReview paper',
    domain: 'openreview.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'OpenReview note id (e.g. "5sRnsubyAK")' },
    ],
    columns: ['id', 'title', 'authors', 'keywords', 'venue', 'venueid', 'primary_area', 'abstract', 'pdate', 'pdf', 'url'],
    func: async (args) => {
        const id = requireForumId(args.id);
        const path = `/notes?id=${encodeURIComponent(id)}`;
        const json = await openreviewFetch(path, `openreview paper ${id}`);
        const notes = Array.isArray(json?.notes) ? json.notes : [];
        if (!notes.length) {
            throw new EmptyResultError('openreview', `No paper found with id "${id}". Confirm the forum/note id from openreview.net.`);
        }
        const row = noteToRow(notes[0]);
        return [{
            id: row.id,
            title: row.title,
            authors: row.authors,
            keywords: row.keywords,
            venue: row.venue,
            venueid: row.venueid,
            primary_area: row.primary_area,
            abstract: row.abstract,
            pdate: row.pdate,
            pdf: row.pdf,
            url: row.url,
        }];
    },
});
