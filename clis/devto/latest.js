// devto latest — newest dev.to articles, regardless of tag.
//
// Hits the public `/api/articles/latest` endpoint. Complements the existing
// `devto top` (most-reactioned) and `devto tag` (filtered) commands by
// surfacing the firehose of brand-new posts.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function requireBoundedInt(value, defaultValue, maxValue) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError('devto limit must be a positive integer');
    }
    if (n > maxValue) {
        throw new ArgumentError(`devto limit must be <= ${maxValue}`);
    }
    return n;
}

cli({
    site: 'devto',
    name: 'latest',
    access: 'read',
    description: 'Newest dev.to articles (firehose, all tags)',
    domain: 'dev.to',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Articles per page (1-100)' },
        { name: 'page', type: 'int', default: 1, help: 'Page number (1-based)' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'tags', 'reactions', 'comments', 'published', 'url'],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 100);
        const page = requireBoundedInt(args.page, 1, 1000);
        const url = `https://dev.to/api/articles/latest?per_page=${limit}&page=${page}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { accept: 'application/json' } });
        }
        catch (err) {
            throw new CommandExecutionError(
                `devto latest request failed: ${err?.message ?? err}`,
                'Check that dev.to is reachable from this network.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`devto latest returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`devto latest returned malformed JSON: ${err?.message ?? err}`);
        }
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('devto latest', `dev.to /articles/latest returned no items at page ${page}.`);
        }
        return list.map((item, i) => ({
            rank: (page - 1) * limit + i + 1,
            id: item.id != null ? String(item.id) : '',
            title: String(item.title ?? ''),
            author: String(item?.user?.username ?? ''),
            tags: String(item.tag_list ?? '').replace(/,\s*/g, ', '),
            reactions: item.public_reactions_count != null ? Number(item.public_reactions_count) : null,
            comments: item.comments_count != null ? Number(item.comments_count) : null,
            published: String(item.published_at ?? '').slice(0, 10),
            url: String(item.url ?? ''),
        }));
    },
});
