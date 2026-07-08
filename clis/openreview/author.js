/**
 * OpenReview submissions by author profile id (newest first).
 *
 * Pairs with `openreview paper <id>` and `openreview reviews <id>` for the
 * full read-side workflow: list every submission an author put on
 * OpenReview, then drill into a specific paper or its review thread.
 *
 * Uses the public v2 endpoint `/notes?content.authorids=~<profile-id>`,
 * which returns the same note shape as `paper`, sorted by `cdate:desc`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    noteToRow,
    openreviewFetch,
    requireBoundedInt,
    requireProfileId,
} from './utils.js';

cli({
    site: 'openreview',
    name: 'author',
    access: 'read',
    description: 'List OpenReview submissions by an author profile id (newest first)',
    domain: 'openreview.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'profile', positional: true, required: true, help: 'OpenReview profile id (e.g. "~Yoshua_Bengio1"). Find it on the author profile URL on openreview.net.' },
        { name: 'limit', type: 'int', default: 50, help: 'Max submissions (1-1000)' },
    ],
    columns: ['rank', 'id', 'title', 'authors', 'venue', 'pdate', 'url'],
    func: async (args) => {
        const profile = requireProfileId(args.profile);
        const limit = requireBoundedInt(args.limit, 50, 1000);
        const path = `/notes?content.authorids=${encodeURIComponent(profile)}&limit=${limit}&sort=cdate:desc`;
        const json = await openreviewFetch(path, `openreview author ${profile}`);
        const notes = Array.isArray(json?.notes) ? json.notes : [];
        if (!notes.length) {
            throw new EmptyResultError(
                'openreview author',
                `No OpenReview submissions found for profile "${profile}". Confirm the id format (~First_LastN) and that the profile has public submissions.`,
            );
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
