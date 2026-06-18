// archive search: Internet Archive Advanced Search across all mediatypes.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

const SORT_OPTIONS = ['downloads', 'date', 'addeddate', 'week', 'title'];
const SORT_ALIAS = { added: 'addeddate', published: 'date' };
const MEDIATYPES = ['texts', 'movies', 'audio', 'software', 'image', 'web', 'data', 'collection'];
const IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/;

cli({
    site: 'archive',
    name: 'search',
    access: 'read',
    description: 'Search Internet Archive items across books, movies, audio, software, and web.',
    domain: 'archive.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Full-text query (matches title, description, creator, subject).' },
        { name: 'mediatype', type: 'string', required: false, help: `Restrict to mediatype: ${MEDIATYPES.join(', ')}` },
        { name: 'sort', type: 'string', default: 'downloads', help: `Sort key: ${SORT_OPTIONS.join(', ')}` },
        { name: 'limit', type: 'int', default: 20, help: 'Max items (max 100; one API page).' },
    ],
    columns: ['rank', 'identifier', 'title', 'creator', 'date', 'mediatype', 'downloads', 'url'],
    func: async (args) => {
        const sortRaw = String(args.sort ?? 'downloads').toLowerCase();
        const sort = SORT_ALIAS[sortRaw] ?? sortRaw;
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`archive search sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        if (args.mediatype && !MEDIATYPES.includes(String(args.mediatype))) {
            throw new ArgumentError(`archive search mediatype must be one of ${MEDIATYPES.join(', ')}`);
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('archive search limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('archive search limit must be <= 100');
        }

        const query = String(args.query ?? '').trim();
        if (!query) {
            throw new ArgumentError('archive search query must not be empty');
        }

        const fullQuery = args.mediatype
            ? `(${query}) AND mediatype:${args.mediatype}`
            : query;

        const url = new URL('https://archive.org/advancedsearch.php');
        url.searchParams.set('q', fullQuery);
        url.searchParams.set('output', 'json');
        url.searchParams.set('rows', String(limit));
        url.searchParams.set('sort[]', `${sort} desc`);
        for (const fl of ['identifier', 'title', 'creator', 'date', 'mediatype', 'downloads']) {
            url.searchParams.append('fl[]', fl);
        }

        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`archive search request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`archive search failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`archive search returned malformed JSON: ${error?.message || error}`);
        }

        const docs = data?.response?.docs;
        if (!Array.isArray(docs)) {
            throw new CommandExecutionError('archive search returned malformed payload: response.docs must be an array');
        }
        if (docs.length === 0) {
            throw new EmptyResultError('archive search', `No items match "${query}" on archive.org.`);
        }

        return docs.slice(0, limit).map((d, i) => {
            const id = String(d.identifier ?? '');
            if (!IDENTIFIER_RE.test(id)) {
                throw new CommandExecutionError('archive search returned malformed payload: result row is missing a stable identifier');
            }
            const downloads = Number(d.downloads ?? 0);
            if (!Number.isFinite(downloads)) {
                throw new CommandExecutionError(`archive search returned malformed payload for "${id}": downloads must be numeric`);
            }
            const creator = Array.isArray(d.creator) ? d.creator.join(', ') : String(d.creator ?? '');
            return {
                rank: i + 1,
                identifier: id,
                title: String(d.title ?? ''),
                creator,
                date: d.date ? String(d.date).slice(0, 10) : '',
                mediatype: String(d.mediatype ?? ''),
                downloads,
                url: id ? `https://archive.org/details/${id}` : '',
            };
        });
    },
});
