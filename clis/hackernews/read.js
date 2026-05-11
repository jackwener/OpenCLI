/**
 * Hacker News story reader with threaded comment tree.
 *
 * Mirrors `reddit read` semantics — fetches a story plus a tree of top-level
 * comments and inline replies via the public Firebase API:
 *   https://hacker-news.firebaseio.com/v0/item/<id>.json
 *
 * Output rows:
 *   - first row is the story itself (`type=POST`)
 *   - each subsequent row is a comment, indented by depth (`L0`, `L1`, …)
 *   - `[+N more replies]` summary rows whenever depth/limit cuts in
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const HN_ITEM_BASE = 'https://hacker-news.firebaseio.com/v0/item';

async function fetchItem(id) {
    const res = await fetch(`${HN_ITEM_BASE}/${id}.json`);
    if (!res.ok) {
        throw new CommandExecutionError(`HN API HTTP ${res.status} for item ${id}`, 'Check the item ID');
    }
    return res.json();
}

function requirePositiveInt(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return value;
}

function requireMinInt(value, min, label) {
    if (!Number.isInteger(value) || value < min) {
        throw new ArgumentError(`${label} must be an integer >= ${min}`);
    }
    return value;
}

/** HN stores comment text as a small HTML subset — convert to plain text. */
function htmlToText(html) {
    if (!html) return '';
    return String(html)
        .replace(/<p>/gi, '\n\n')
        .replace(/<\/p>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<i>(.*?)<\/i>/gi, '$1')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
        .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '\n$1\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x2F;/g, '/')
        .trim();
}

function indentLines(text, depth) {
    if (depth === 0) return text;
    const indent = '  '.repeat(depth);
    const prefix = `${indent}> `;
    return text.split('\n').map((line) => prefix + line).join('\n');
}

function moreRepliesIndent(depth) {
    return '  '.repeat(depth + 1);
}

cli({
    site: 'hackernews',
    name: 'read',
    access: 'read',
    description: 'Read a Hacker News story and its comment tree',
    domain: 'news.ycombinator.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'HN item ID (e.g. 39847301)' },
        { name: 'limit', type: 'int', default: 25, help: 'Max top-level comments' },
        { name: 'depth', type: 'int', default: 2, help: 'Max reply depth (1=no replies, 2=one level of replies, etc.)' },
        { name: 'replies', type: 'int', default: 5, help: 'Max replies shown per comment at each level' },
        { name: 'max-length', type: 'int', default: 2000, help: 'Max characters per comment body (min 100)' },
    ],
    columns: ['type', 'author', 'score', 'text'],
    func: async (args) => {
        const id = String(args.id || '').trim();
        if (!/^\d+$/.test(id)) {
            throw new ArgumentError(`Invalid HN item id: ${args.id}`, 'Pass a numeric id like 39847301');
        }
        const limit = requirePositiveInt(args.limit ?? 25, 'hackernews read --limit');
        const maxDepth = requirePositiveInt(args.depth ?? 2, 'hackernews read --depth');
        const maxReplies = requirePositiveInt(args.replies ?? 5, 'hackernews read --replies');
        const maxLength = requireMinInt(args['max-length'] ?? 2000, 100, 'hackernews read --max-length');

        const story = await fetchItem(id);
        if (!story || story.deleted || story.dead) {
            throw new EmptyResultError(`hackernews/${id}`, 'Story not found, deleted, or dead');
        }

        const results = [];

        // Story header row. text combines title + selftext (Ask/Show HN body) + external URL.
        const storyBodyRaw = htmlToText(story.text || '');
        const storyBody = storyBodyRaw.length > maxLength
            ? storyBodyRaw.slice(0, maxLength) + '\n... [truncated]'
            : storyBodyRaw;
        const storyParts = [story.title || ''];
        if (storyBody) storyParts.push('\n' + storyBody);
        if (story.url) storyParts.push('\n' + story.url);
        results.push({
            type: 'POST',
            author: story.by || '[deleted]',
            score: story.score ?? 0,
            text: storyParts.join('').trim(),
        });

        // Walk top-level comments using `kids` ids; fetch the first `limit` ids in parallel.
        const topKids = Array.isArray(story.kids) ? story.kids : [];
        const topToFetch = topKids.slice(0, limit);
        const fetched = await Promise.all(topToFetch.map((kidId) => fetchItem(kidId).catch(() => null)));

        async function walkComment(node, depth) {
            if (!node || node.deleted || node.dead || node.type !== 'comment') return;
            const bodyText = htmlToText(node.text || '');
            const truncated = bodyText.length > maxLength
                ? bodyText.slice(0, maxLength) + '...'
                : bodyText;

            results.push({
                type: depth === 0 ? 'L0' : `L${depth}`,
                author: node.by || '[deleted]',
                score: '',
                text: indentLines(truncated, depth),
            });

            const childIds = Array.isArray(node.kids) ? node.kids : [];

            // At depth cutoff: don't recurse, but show a "+N more replies" stub if any.
            if (depth + 1 >= maxDepth) {
                if (childIds.length > 0) {
                    results.push({
                        type: `L${depth + 1}`,
                        author: '',
                        score: '',
                        text: `${moreRepliesIndent(depth)}[+${childIds.length} more replies]`,
                    });
                }
                return;
            }

            const toProcess = childIds.slice(0, maxReplies);
            const replies = await Promise.all(toProcess.map((cid) => fetchItem(cid).catch(() => null)));
            for (const reply of replies) {
                await walkComment(reply, depth + 1);
            }

            // "+N more replies" for whatever we skipped at this level
            const hidden = childIds.length - toProcess.length;
            if (hidden > 0) {
                results.push({
                    type: `L${depth + 1}`,
                    author: '',
                    score: '',
                    text: `${moreRepliesIndent(depth)}[+${hidden} more replies]`,
                });
            }
        }

        for (const comment of fetched) {
            await walkComment(comment, 0);
        }

        const hiddenTopLevel = Math.max(0, topKids.length - topToFetch.length);
        if (hiddenTopLevel > 0) {
            results.push({
                type: '',
                author: '',
                score: '',
                text: `[+${hiddenTopLevel} more top-level comments]`,
            });
        }

        return results;
    },
});
