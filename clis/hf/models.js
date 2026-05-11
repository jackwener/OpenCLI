// hf models — list top Hugging Face models (by downloads / likes / trending).
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
    name: 'models',
    access: 'read',
    description: 'Top Hugging Face models (downloads / likes / trending / freshness).',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'sort', type: 'string', default: 'downloads', help: `Sort key: ${SORT_OPTIONS.join(', ')}` },
        { name: 'search', type: 'string', required: false, help: 'Optional name/owner substring filter (e.g. "llama", "mistralai/")' },
        { name: 'pipeline', type: 'string', required: false, help: 'Filter by pipeline tag (e.g. text-generation, image-classification)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max models (max 100; one API page).' },
    ],
    columns: ['rank', 'id', 'author', 'pipelineTag', 'downloads', 'likes', 'tags', 'lastModified', 'url'],
    func: async (args) => {
        const sortRaw = String(args.sort ?? 'downloads').toLowerCase();
        const sort = SORT_ALIAS[sortRaw] ?? sortRaw;
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`hf models sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('hf models limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('hf models limit must be <= 100');
        }

        const url = new URL('https://huggingface.co/api/models');
        url.searchParams.set('sort', sort);
        url.searchParams.set('direction', '-1');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('full', 'true');
        if (args.search) url.searchParams.set('search', String(args.search));
        if (args.pipeline) url.searchParams.set('pipeline_tag', String(args.pipeline));

        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`hf models request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`hf models failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`hf models returned malformed JSON: ${error?.message || error}`);
        }
        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) {
            throw new EmptyResultError('hf models', 'No matching models on huggingface.co.');
        }
        return list.slice(0, limit).map((m, i) => {
            const id = m.id || m.modelId || '';
            const slashIdx = id.indexOf('/');
            const author = slashIdx > 0 ? id.slice(0, slashIdx) : '';
            const tags = Array.isArray(m.tags) ? m.tags.filter(t => !t.startsWith('license:')).slice(0, 10).join(', ') : '';
            return {
                rank: i + 1,
                id,
                author,
                pipelineTag: m.pipeline_tag || m.pipelineTag || '',
                downloads: m.downloads ?? 0,
                likes: m.likes ?? 0,
                tags,
                lastModified: m.lastModified ? String(m.lastModified).slice(0, 10) : '',
                url: id ? `https://huggingface.co/${id}` : '',
            };
        });
    },
});
