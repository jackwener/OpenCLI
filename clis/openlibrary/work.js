// openlibrary work — fetch full Open Library metadata for a work.
//
// Hits `https://openlibrary.org/works/<id>.json`. Returns the agent-useful
// projection: title, description, subject taxonomy, cover ids, first published
// date, link to OL author page (round-trip not supported — author keys go to a
// different endpoint), ratings via separate `/works/<id>/ratings.json` lookup.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OL_BASE, flattenDescription, olFetch, requireWorkKey } from './utils.js';

function pickAuthorKeys(work) {
    if (!Array.isArray(work?.authors)) return [];
    return work.authors
        .map((entry) => {
            const k = entry?.author?.key;
            if (typeof k !== 'string') return null;
            const slash = k.lastIndexOf('/');
            return slash >= 0 ? k.slice(slash + 1) : k;
        })
        .filter(Boolean);
}

cli({
    site: 'openlibrary',
    name: 'work',
    access: 'read',
    description: 'Fetch Open Library metadata for a work id (OL...W)',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'workKey', positional: true, required: true, help: 'Open Library work key (e.g. "OL45804W"; "/works/OL45804W" or full URL accepted)' },
    ],
    columns: [
        'workKey', 'title', 'subtitle', 'authors', 'description', 'subjects',
        'subjectPlaces', 'subjectPeople', 'subjectTimes', 'firstPublished',
        'coverIds', 'rating', 'ratingsCount', 'editionsUrl', 'url',
    ],
    func: async (args) => {
        const workKey = requireWorkKey(args.workKey);
        const url = `${OL_BASE}/works/${workKey}.json`;
        const work = await olFetch(url, 'openlibrary work');
        // Ratings live on a sibling endpoint; tolerate missing ratings without
        // failing the whole detail call.
        let ratingSummary = null;
        let ratingsCount = null;
        try {
            const r = await olFetch(`${OL_BASE}/works/${workKey}/ratings.json`, 'openlibrary work ratings');
            const avg = r?.summary?.average;
            if (typeof avg === 'number') ratingSummary = Number(avg.toFixed(2));
            if (typeof r?.summary?.count === 'number') ratingsCount = r.summary.count;
        } catch (err) {
            // Empty / 404 ratings are normal for niche works; non-network errors
            // still bubble out so we don't silently mask broader regressions.
            if (!(err instanceof EmptyResultError)) throw err;
        }
        const subjects = Array.isArray(work?.subjects) ? work.subjects : [];
        const subjectPlaces = Array.isArray(work?.subject_places) ? work.subject_places : [];
        const subjectPeople = Array.isArray(work?.subject_people) ? work.subject_people : [];
        const subjectTimes = Array.isArray(work?.subject_times) ? work.subject_times : [];
        const covers = Array.isArray(work?.covers) ? work.covers.filter((c) => typeof c === 'number' && c > 0) : [];
        return [{
            workKey,
            title: String(work?.title ?? '').trim(),
            subtitle: String(work?.subtitle ?? '').trim() || null,
            authors: pickAuthorKeys(work).join(', ') || null,
            description: flattenDescription(work?.description) || null,
            subjects: subjects.slice(0, 20).join(', ') || null,
            subjectPlaces: subjectPlaces.slice(0, 10).join(', ') || null,
            subjectPeople: subjectPeople.slice(0, 10).join(', ') || null,
            subjectTimes: subjectTimes.slice(0, 10).join(', ') || null,
            firstPublished: String(work?.first_publish_date ?? '').trim() || null,
            coverIds: covers.length ? covers.slice(0, 5).join(', ') : null,
            rating: ratingSummary,
            ratingsCount,
            editionsUrl: `${OL_BASE}/works/${workKey}/editions.json`,
            url: `${OL_BASE}/works/${workKey}`,
        }];
    },
});
