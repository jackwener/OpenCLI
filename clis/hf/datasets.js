// hf datasets — list top Hugging Face datasets.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

const SORT_OPTIONS = ['downloads', 'likes', 'trending', 'created_at', 'last_modified'];
const SORT_ALIAS = { lastmodified: 'last_modified', createdat: 'created_at' };

cli({
    site: 'hf',
    name: 'datasets',
    access: 'read',
    description: 'Top Hugging Face datasets (downloads / likes / trending / freshness).',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'sort', type: 'string', default: 'downloads', help: `Sort key: ${SORT_OPTIONS.join(', ')}` },
        { name: 'search', type: 'string', required: false, help: 'Optional name/owner substring filter.' },
        { name: 'limit', type: 'int', default: 20, help: 'Max datasets (max 100; one API page).' },
    ],
    columns: ['rank', 'id', 'author', 'downloads', 'likes', 'tags', 'lastModified', 'url'],
    func: async (args) => {
        const sortRaw = String(args.sort ?? 'downloads').toLowerCase();
        const sort = SORT_ALIAS[sortRaw] ?? sortRaw;
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`hf datasets sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('hf datasets limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('hf datasets limit must be <= 100');
        }

        const url = new URL('https://huggingface.co/api/datasets');
        url.searchParams.set('sort', sort);
        url.searchParams.set('direction', '-1');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('full', 'true');
        if (args.search) url.searchParams.set('search', String(args.search));

        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`hf datasets request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`hf datasets failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`hf datasets returned malformed JSON: ${error?.message || error}`);
        }
        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) {
            throw new EmptyResultError('hf datasets', 'No matching datasets on huggingface.co.');
        }
        return list.slice(0, limit).map((d, i) => {
            const id = d.id || '';
            const slashIdx = id.indexOf('/');
            const author = slashIdx > 0 ? id.slice(0, slashIdx) : '';
            const tags = Array.isArray(d.tags) ? d.tags.filter(t => !t.startsWith('license:')).slice(0, 10).join(', ') : '';
            return {
                rank: i + 1,
                id,
                author,
                downloads: d.downloads ?? 0,
                likes: d.likes ?? 0,
                tags,
                lastModified: d.lastModified ? String(d.lastModified).slice(0, 10) : '',
                url: id ? `https://huggingface.co/datasets/${id}` : '',
            };
        });
    },
});
