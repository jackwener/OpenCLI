/**
 * OpenReview venue listing.
 *
 * Accepts either:
 *   • a venue name (matched against `content.venue`, e.g. "ICLR 2024 oral"), or
 *   • a full invitation id (e.g. "ICLR.cc/2025/Conference/-/Submission").
 *
 * Invitations contain the literal `/-/` segment, so we use that to disambiguate.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { noteToRow, openreviewFetch, requireBoundedInt, requireNonNegativeInt } from './utils.js';

cli({
    site: 'openreview',
    name: 'venue',
    access: 'read',
    description: 'List papers at an OpenReview venue (e.g. "ICLR 2024 oral" or full invitation id)',
    domain: 'openreview.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'venue', positional: true, required: true, help: 'Venue name ("ICLR 2024 oral") or invitation ("ICLR.cc/2025/Conference/-/Submission")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max results (max 200)' },
        { name: 'offset', type: 'int', default: 0, help: 'Pagination offset' },
    ],
    columns: ['rank', 'id', 'title', 'authors', 'keywords', 'primary_area', 'pdate', 'pdf', 'url'],
    func: async (args) => {
        const value = String(args.venue ?? '').trim();
        if (!value) {
            throw new ArgumentError('openreview venue cannot be empty');
        }
        const limit = requireBoundedInt(args.limit, 25, 200);
        const offset = requireNonNegativeInt(args.offset, 0);
        const isInvitation = value.includes('/-/');
        const filter = isInvitation
            ? `invitation=${encodeURIComponent(value)}`
            : `content.venue=${encodeURIComponent(value)}`;
        const path = `/notes?${filter}&limit=${limit}&offset=${offset}`;
        const json = await openreviewFetch(path, `openreview venue ${value}`);
        const notes = Array.isArray(json?.notes) ? json.notes : [];
        if (!notes.length) {
            const hint = isInvitation
                ? 'Check the invitation id (e.g. "ICLR.cc/2025/Conference/-/Submission").'
                : 'Try a venue text like "ICLR 2024 oral" or pass a full invitation id.';
            throw new EmptyResultError('openreview', `No papers found at venue "${value}". ${hint}`);
        }
        return notes.slice(0, limit).map((note, i) => {
            const row = noteToRow(note);
            return {
                rank: offset + i + 1,
                id: row.id,
                title: row.title,
                authors: row.authors,
                keywords: row.keywords,
                primary_area: row.primary_area,
                pdate: row.pdate,
                pdf: row.pdf,
                url: row.url,
            };
        });
    },
});
