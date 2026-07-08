/**
 * DEV.to article reader.
 *
 * Public API: https://dev.to/api/articles/<id>
 * Returns the full article including `body_markdown` (and `body_html`).
 *
 * The DEV.to API does not currently expose article comments — this reader
 * therefore emits one row with the article body. If/when comments become
 * available we can extend to a POST + L0/L1 shape like `hackernews read`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const DEVTO_ARTICLE_BASE = 'https://dev.to/api/articles';

async function fetchArticle(id) {
    let res;
    try {
        res = await fetch(`${DEVTO_ARTICLE_BASE}/${id}`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`DEV.to API request failed for article ${id}`, detail);
    }
    if (res.status === 404) {
        throw new EmptyResultError(`devto/${id}`, 'Article not found');
    }
    if (!res.ok) {
        throw new CommandExecutionError(`DEV.to API HTTP ${res.status} for article ${id}`, 'Check the article id');
    }
    try {
        return await res.json();
    } catch {
        throw new CommandExecutionError(`DEV.to API returned invalid JSON for article ${id}`, 'Retry later or open the article URL directly');
    }
}

function requireMinInt(value, min, label) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number < min) {
        throw new ArgumentError(`${label} must be an integer >= ${min}`);
    }
    return number;
}

function requireArticleBody(article, id) {
    if (typeof article.body_markdown === 'string' && article.body_markdown.trim()) {
        return article.body_markdown;
    }
    throw new CommandExecutionError(
        `DEV.to article ${id} did not include body_markdown`,
        'DEV.to API response shape may have changed. Open the article URL directly or retry later.',
    );
}

cli({
    site: 'devto',
    name: 'read',
    access: 'read',
    description: 'Read a DEV.to article body by id',
    domain: 'dev.to',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'DEV.to article id (numeric, e.g. 3605688)' },
        { name: 'max-length', type: 'int', default: 20000, help: 'Max characters of body to return (min 100)' },
    ],
    columns: ['id', 'title', 'author', 'reactions', 'reading_time', 'tags', 'published_at', 'body', 'url'],
    func: async (args) => {
        const id = String(args.id || '').trim();
        if (!/^\d+$/.test(id)) {
            throw new ArgumentError(`Invalid DEV.to article id: ${args.id}`, 'Pass a numeric id like 3605688');
        }
        const maxLength = requireMinInt(args['max-length'] ?? 20000, 100, 'devto read --max-length');

        const article = await fetchArticle(id);
        if (!article || !article.id) {
            throw new EmptyResultError(`devto/${id}`, 'Article not found');
        }

        const body = requireArticleBody(article, id);
        const truncated = body.length > maxLength
            ? body.slice(0, maxLength) + '\n\n... [truncated]'
            : body;

        // The single-article endpoint returns `tag_list` as a comma-separated
        // string and `tags` as an array — the opposite of the listing endpoints.
        // Normalize either shape into a single comma-separated string.
        const tagsRaw = article.tag_list ?? article.tags ?? '';
        const tags = Array.isArray(tagsRaw) ? tagsRaw.join(', ') : String(tagsRaw);

        return [{
            id: article.id,
            title: article.title || '',
            author: article.user?.username || '[deleted]',
            reactions: article.public_reactions_count ?? 0,
            reading_time: article.reading_time_minutes ?? 0,
            tags,
            published_at: article.published_at || '',
            body: truncated,
            url: article.url || '',
        }];
    },
});
