// stackoverflow tag — list questions tagged with a given tag (most active first).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    seFetch,
    normalizeLimit,
    requireString,
    epochToDate,
    ensureItems,
    decodeHtmlEntities,
} from './utils.js';

const SORT_OPTIONS = ['activity', 'votes', 'creation', 'hot', 'week', 'month'];

cli({
    site: 'stackoverflow',
    name: 'tag',
    access: 'read',
    description: 'List Stack Overflow questions tagged with a given tag (most active first).',
    domain: 'stackoverflow.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'tag', positional: true, required: true, type: 'string', help: 'Tag slug (e.g. python, rust, typescript).' },
        { name: 'sort', type: 'string', default: 'activity', help: `Sort key: ${SORT_OPTIONS.join(', ')}` },
        { name: 'limit', type: 'int', default: 20, help: 'Max questions to return (max 100).' },
    ],
    columns: ['rank', 'id', 'title', 'score', 'answers', 'views', 'isAnswered', 'tags', 'author', 'createdAt', 'lastActivityAt', 'url'],
    func: async (args) => {
        const tag = requireString(args.tag, 'tag').toLowerCase();
        const sort = String(args.sort ?? 'activity').toLowerCase();
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        const limit = normalizeLimit(args.limit, 20, 100, 'limit');
        const data = await seFetch(`/questions`, {
            searchParams: {
                tagged: tag,
                order: 'desc',
                sort,
                pagesize: limit,
            },
        });
        const items = ensureItems(data, `stackoverflow tag "${tag}"`);
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
