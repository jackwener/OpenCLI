// lobsters domain — list Lobste.rs stories submitted from a specific domain.
//
// Hits the public `https://lobste.rs/domains/<domain>.json` endpoint
// (returns the same per-story shape used by `lobsters tag` / `lobsters
// hot`). Lets agents ask "what did Lobsters surface from github.com /
// blog.cloudflare.com / arxiv.org lately?".
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function requireDomain(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) {
        throw new ArgumentError('lobsters domain is required (e.g. "github.com" or "arxiv.org")');
    }
    if (!DOMAIN_PATTERN.test(s)) {
        throw new ArgumentError(`lobsters domain "${value}" is not a valid hostname`);
    }
    return s;
}

function requireBoundedInt(value, defaultValue, maxValue) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError('lobsters limit must be a positive integer');
    }
    if (n > maxValue) {
        throw new ArgumentError(`lobsters limit must be <= ${maxValue}`);
    }
    return n;
}

cli({
    site: 'lobsters',
    name: 'domain',
    access: 'read',
    description: 'Lobste.rs stories submitted from a specific domain',
    domain: 'lobste.rs',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'domain', positional: true, required: true, help: 'Source domain (e.g. github.com, arxiv.org, blog.cloudflare.com)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of stories (1-25 — single page)' },
    ],
    columns: ['rank', 'id', 'title', 'score', 'author', 'comments', 'created_at', 'tags', 'submission_url', 'comments_url'],
    func: async (args) => {
        const domain = requireDomain(args.domain);
        const limit = requireBoundedInt(args.limit, 20, 25);
        const url = `https://lobste.rs/domains/${encodeURIComponent(domain)}.json`;
        let resp;
        try {
            resp = await fetch(url, { headers: { 'user-agent': 'opencli-lobsters-adapter (+https://github.com/jackwener/opencli)' } });
        }
        catch (err) {
            throw new CommandExecutionError(
                `lobsters domain request failed: ${err?.message ?? err}`,
                'Check that lobste.rs is reachable from this network.',
            );
        }
        if (resp.status === 404) {
            throw new EmptyResultError('lobsters domain', `No Lobste.rs stories found for domain "${domain}".`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`lobsters domain returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`lobsters domain returned malformed JSON: ${err?.message ?? err}`);
        }
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('lobsters domain', `No Lobste.rs stories found for domain "${domain}".`);
        }
        return list.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            id: String(item.short_id ?? ''),
            title: String(item.title ?? ''),
            score: item.score != null ? Number(item.score) : null,
            author: String(item.submitter_user ?? ''),
            comments: item.comment_count != null ? Number(item.comment_count) : null,
            created_at: String(item.created_at ?? '').slice(0, 10),
            tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
            submission_url: String(item.url ?? ''),
            comments_url: String(item.comments_url ?? ''),
        }));
    },
});
