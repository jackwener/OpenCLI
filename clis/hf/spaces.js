// hf spaces — list top Hugging Face Spaces (gradio / streamlit / static demos).
//
// Hits `https://huggingface.co/api/spaces?sort=…&full=true`. Mirrors the shape
// of `hf models` / `hf datasets`. The Spaces API does not expose `trending` as
// a sort key (verified live: returns "Invalid sort parameter"), so the allowed
// sort set is narrower.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const SORT_OPTIONS = ['likes', 'created_at', 'last_modified'];
const SORT_ALIAS = { lastmodified: 'last_modified', createdat: 'created_at' };

cli({
    site: 'hf',
    name: 'spaces',
    access: 'read',
    description: 'Top Hugging Face Spaces (likes / created_at / last_modified).',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'sort', type: 'string', default: 'likes', help: `Sort key: ${SORT_OPTIONS.join(', ')}` },
        { name: 'search', type: 'string', required: false, help: 'Optional name/owner substring filter (e.g. "stability", "openai/")' },
        { name: 'sdk', type: 'string', required: false, help: 'Filter by Space SDK: gradio / streamlit / docker / static' },
        { name: 'limit', type: 'int', default: 20, help: 'Max spaces (max 100; one API page).' },
    ],
    columns: ['rank', 'id', 'author', 'sdk', 'likes', 'tags', 'lastModified', 'url'],
    func: async (args) => {
        const sortRaw = String(args.sort ?? 'likes').toLowerCase();
        const sort = SORT_ALIAS[sortRaw] ?? sortRaw;
        if (!SORT_OPTIONS.includes(sort)) {
            throw new ArgumentError(`hf spaces sort must be one of ${SORT_OPTIONS.join(', ')}`);
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('hf spaces limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('hf spaces limit must be <= 100');
        }
        const sdk = args.sdk == null ? '' : String(args.sdk).trim().toLowerCase();
        const allowedSdks = new Set(['', 'gradio', 'streamlit', 'docker', 'static']);
        if (!allowedSdks.has(sdk)) {
            throw new ArgumentError(`hf spaces sdk must be one of gradio / streamlit / docker / static`);
        }

        const url = new URL('https://huggingface.co/api/spaces');
        url.searchParams.set('sort', sort);
        url.searchParams.set('direction', '-1');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('full', 'true');
        if (args.search) url.searchParams.set('search', String(args.search));
        if (sdk) url.searchParams.set('sdk', sdk);

        let resp;
        try {
            resp = await fetch(url, {
                headers: { Accept: 'application/json', 'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)' },
            });
        }
        catch (err) {
            throw new CommandExecutionError(`hf spaces request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'hf spaces returned HTTP 429 (rate limited)',
                'Hugging Face throttles unauthenticated traffic; wait a few seconds and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`hf spaces failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`hf spaces returned malformed JSON: ${err?.message ?? err}`);
        }
        const list = Array.isArray(data) ? data : [];
        if (!list.length) {
            throw new EmptyResultError('hf spaces', 'No matching spaces on huggingface.co.');
        }
        return list.slice(0, limit).map((s, i) => {
            const id = String(s.id ?? s._id ?? '');
            const slash = id.indexOf('/');
            const author = String(s.author ?? (slash > 0 ? id.slice(0, slash) : ''));
            const tags = Array.isArray(s.tags) ? s.tags.filter((t) => !String(t).startsWith('license:')).slice(0, 10).join(', ') : '';
            return {
                rank: i + 1,
                id,
                author,
                sdk: String(s.sdk ?? ''),
                likes: s.likes != null ? Number(s.likes) : null,
                tags,
                lastModified: String(s.lastModified ?? '').slice(0, 10),
                url: id ? `https://huggingface.co/spaces/${id}` : '',
            };
        });
    },
});
