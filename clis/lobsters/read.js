/**
 * Lobste.rs story reader with threaded comment tree.
 *
 * Mirrors `hackernews read` semantics. The lobsters JSON endpoint:
 *   https://lobste.rs/s/<short_id>.json
 * already returns the story plus a flat `comments[]` array where each entry
 * carries `parent_comment` (short_id of parent or null) and `depth` — so we
 * just need one HTTP call, then build a children map and DFS.
 *
 * Output rows:
 *   - first row is the story itself (`type=POST`)
 *   - each subsequent row is a comment, indented by depth (`L0`, `L1`, …)
 *   - `[+N more replies]` summary rows whenever depth/limit cuts in
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const LOBSTERS_STORY_BASE = 'https://lobste.rs/s';

async function fetchStory(shortId) {
    const res = await fetch(`${LOBSTERS_STORY_BASE}/${shortId}.json`);
    if (res.status === 404) {
        throw new EmptyResultError(`lobsters/${shortId}`, 'Story not found');
    }
    if (!res.ok) {
        throw new CommandExecutionError(`Lobsters API HTTP ${res.status} for story ${shortId}`, 'Check the short id');
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

/** Lobsters returns comment text as a small HTML subset — convert to plain text. */
function htmlToText(html) {
    if (!html) return '';
    return String(html)
        .replace(/<p>/gi, '\n\n')
        .replace(/<\/p>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<i>(.*?)<\/i>/gi, '$1')
        .replace(/<em>(.*?)<\/em>/gi, '$1')
        .replace(/<strong>(.*?)<\/strong>/gi, '$1')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
        .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '\n$1\n')
        .replace(/<code>(.*?)<\/code>/gi, '`$1`')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
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
    site: 'lobsters',
    name: 'read',
    access: 'read',
    description: 'Read a Lobste.rs story and its comment tree',
    domain: 'lobste.rs',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Lobste.rs short_id (e.g. 6cmh6h)' },
        { name: 'limit', type: 'int', default: 25, help: 'Max top-level comments' },
        { name: 'depth', type: 'int', default: 2, help: 'Max reply depth (1=no replies, 2=one level of replies, etc.)' },
        { name: 'replies', type: 'int', default: 5, help: 'Max replies shown per comment at each level' },
        { name: 'max-length', type: 'int', default: 2000, help: 'Max characters per comment body (min 100)' },
    ],
    columns: ['type', 'author', 'score', 'text'],
    func: async (args) => {
        const shortId = String(args.id || '').trim();
        if (!/^[a-z0-9]+$/.test(shortId)) {
            throw new ArgumentError(`Invalid Lobsters short_id: ${args.id}`, 'Pass a lowercase alphanumeric id like 6cmh6h');
        }
        const limit = requirePositiveInt(args.limit ?? 25, 'lobsters read --limit');
        const maxDepth = requirePositiveInt(args.depth ?? 2, 'lobsters read --depth');
        const maxReplies = requirePositiveInt(args.replies ?? 5, 'lobsters read --replies');
        const maxLength = requireMinInt(args['max-length'] ?? 2000, 100, 'lobsters read --max-length');

        const story = await fetchStory(shortId);
        if (!story || !story.short_id) {
            throw new EmptyResultError(`lobsters/${shortId}`, 'Story not found');
        }

        const results = [];

        // Story header — title, body (description_plain, often empty for link posts), then external url.
        const storyBodyRaw = (story.description_plain || htmlToText(story.description || '')).trim();
        const storyBody = storyBodyRaw.length > maxLength
            ? storyBodyRaw.slice(0, maxLength) + '\n... [truncated]'
            : storyBodyRaw;
        const storyParts = [story.title || ''];
        if (storyBody) storyParts.push('\n' + storyBody);
        if (story.url) storyParts.push('\n' + story.url);
        results.push({
            type: 'POST',
            author: story.submitter_user || '[deleted]',
            score: story.score ?? 0,
            text: storyParts.join('').trim(),
        });

        // Build a map: parent_comment -> [child comments in order]. Top-level keyed by null.
        const allComments = Array.isArray(story.comments) ? story.comments : [];
        const childrenMap = new Map();
        for (const c of allComments) {
            const parent = c.parent_comment || null;
            if (!childrenMap.has(parent)) childrenMap.set(parent, []);
            childrenMap.get(parent).push(c);
        }

        function emit(comment, depth) {
            if (!comment || comment.is_deleted || comment.is_moderated) return;
            const bodyRaw = (comment.comment_plain || htmlToText(comment.comment || '')).trim();
            const truncated = bodyRaw.length > maxLength
                ? bodyRaw.slice(0, maxLength) + '...'
                : bodyRaw;

            results.push({
                type: depth === 0 ? 'L0' : `L${depth}`,
                author: comment.commenting_user || '[deleted]',
                score: comment.score ?? '',
                text: indentLines(truncated, depth),
            });

            const kids = childrenMap.get(comment.short_id) || [];
            // At depth cutoff: don't recurse, but show a "+N more replies" stub if any.
            if (depth + 1 >= maxDepth) {
                if (kids.length > 0) {
                    results.push({
                        type: `L${depth + 1}`,
                        author: '',
                        score: '',
                        text: `${moreRepliesIndent(depth)}[+${kids.length} more replies]`,
                    });
                }
                return;
            }

            const toShow = kids.slice(0, maxReplies);
            for (const kid of toShow) emit(kid, depth + 1);

            const hidden = kids.length - toShow.length;
            if (hidden > 0) {
                results.push({
                    type: `L${depth + 1}`,
                    author: '',
                    score: '',
                    text: `${moreRepliesIndent(depth)}[+${hidden} more replies]`,
                });
            }
        }

        const topLevel = childrenMap.get(null) || [];
        const topToShow = topLevel.slice(0, limit);
        for (const top of topToShow) emit(top, 0);

        const hiddenTopLevel = topLevel.length - topToShow.length;
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
