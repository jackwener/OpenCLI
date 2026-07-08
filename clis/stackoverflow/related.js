// stackoverflow related — find Stack Overflow questions related to a given question id.
//
// Hits the public `/questions/{id}/related` endpoint. Useful for follow-up
// research from a single SO question — agents can read one question with
// `stackoverflow read`, then expand the search to related/duplicate threads
// without rerunning a free-text search.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    seFetch,
    normalizeLimit,
    epochToDate,
    ensureItems,
    decodeHtmlEntities,
} from './utils.js';

const SORT_OPTIONS = ['rank', 'activity', 'votes', 'creation'];

cli({
    site: 'stackoverflow',
    name: 'related',
    access: 'read',
    description: 'List Stack Overflow questions related to a given question id.',
    domain: 'stackoverflow.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, type: 'string', help: 'Stack Overflow question id (numeric, e.g. 79935770).' },
        { name: 'sort', type: 'string', default: 'rank', help: `Sort key: ${SORT_OPTIONS.join(', ')} (rank = SO relevance default).` },
        { name: 'limit', type: 'int', default: 20, help: 'Max related questions (1-100).' },
    ],
    columns: ['rank', 'id', 'title', 'score', 'answers', 'views', 'isAnswered', 'tags', 'author', 'createdAt', 'lastActivityAt', 'url'],
    func: async (args) => {
        const id = String(args.id ?? '').trim();
        if (!/^\d+$/.test(id)) {
            throw new ArgumentError(`stackoverflow related id must be a numeric question id, got ${JSON.stringify(args.id)}`);
        }
        const sort = String(args.sort ?? 'rank').toLowerCase();
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`stackoverflow related sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        const limit = normalizeLimit(args.limit, 20, 100, 'limit');
        const data = await seFetch(`/questions/${encodeURIComponent(id)}/related`, {
            searchParams: {
                order: 'desc',
                sort,
                pagesize: limit,
            },
        });
        const items = ensureItems(data, `stackoverflow related ${id}`);
        return items.slice(0, limit).map((q, i) => ({
            rank: i + 1,
            id: q.question_id,
            title: decodeHtmlEntities(q.title || ''),
            score: q.score ?? 0,
            answers: q.answer_count ?? 0,
            views: q.view_count ?? 0,
            isAnswered: Boolean(q.is_answered),
            tags: Array.isArray(q.tags) ? q.tags.join(', ') : '',
            author: decodeHtmlEntities(q.owner?.display_name || ''),
            createdAt: epochToDate(q.creation_date),
            lastActivityAt: epochToDate(q.last_activity_date),
            url: q.link || (q.question_id ? `https://stackoverflow.com/questions/${q.question_id}` : ''),
        }));
    },
});
