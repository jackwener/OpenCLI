import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, getRegistry, Strategy } from '@jackwener/opencli/registry';
import { readFileSync, statSync } from 'node:fs';

const DEFAULT_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

/**
 * Split raw text into thread segments. A line containing only `---` (optionally
 * surrounded by whitespace) is the segment delimiter; if none is present, fall
 * back to splitting on blank lines. Empty segments are dropped.
 */
export function parseThreadSegments(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const hasRule = /^\s*---\s*$/m.test(text);
    const parts = hasRule ? text.split(/^\s*---\s*$/m) : text.split(/\n\s*\n/);
    const segments = parts.map((s) => s.trim()).filter(Boolean);
    if (!segments.length) {
        throw new ArgumentError('No thread segments found. Separate tweets with a line containing only "---" (or blank lines).');
    }
    return segments;
}

function resolveSegments(kwargs) {
    if (kwargs.file) {
        const file = String(kwargs.file);
        let st;
        try {
            st = statSync(file);
        } catch {
            throw new ArgumentError(`File not found: ${file}`);
        }
        if (!st.isFile()) {
            throw new ArgumentError(`Not a readable file: ${file}`);
        }
        return parseThreadSegments(readFileSync(file, 'utf-8'));
    }
    if (typeof kwargs.text === 'string' && kwargs.text.trim()) {
        return parseThreadSegments(kwargs.text);
    }
    throw new ArgumentError('Provide thread text via <text> or --file.');
}

function idFromUrl(url) {
    const m = String(url || '').match(/\/status\/(\d+)/);
    return m ? m[1] : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cli({
    site: 'twitter',
    name: 'post-thread',
    access: 'write',
    description: 'Post a multi-tweet thread: the first tweet, then each subsequent tweet as a reply to the previous one.',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', positional: true, help: 'Thread text; separate tweets with a line of "---" or blank lines' },
        { name: 'file', help: 'Path to a text file with the thread (tweets separated by "---" or blank lines)' },
        { name: 'delay', type: 'int', default: DEFAULT_DELAY_MS, help: `Delay in ms between posts (default ${DEFAULT_DELAY_MS})` },
    ],
    columns: ['status', 'index', 'id', 'url', 'text'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter post-thread');

        const segments = resolveSegments(kwargs);
        const delay = Math.min(Math.max(Number(kwargs.delay ?? DEFAULT_DELAY_MS) || 0, 0), MAX_DELAY_MS);

        // Reuse the already-tested single-tweet `post` and `reply` commands so
        // this command owns only the orchestration (chaining + pacing), not the
        // fragile Draft.js composer handling.
        const registry = getRegistry();
        const post = registry.get('twitter/post');
        const reply = registry.get('twitter/reply');
        if (!post || !reply) {
            throw new CommandExecutionError('twitter post/reply commands are unavailable in the registry');
        }

        const rows = [];
        let prevUrl = '';
        for (let i = 0; i < segments.length; i++) {
            const text = segments[i];
            if (i > 0 && delay) await sleep(delay);

            let result;
            if (i === 0) {
                [result] = await post.func(page, { text });
            } else {
                [result] = await reply.func(page, { url: prevUrl, text });
            }

            const ok = result?.status === 'success';
            const url = result?.url ?? '';
            rows.push({
                status: result?.status ?? 'failed',
                index: i + 1,
                id: idFromUrl(url),
                url,
                text,
            });

            // Stop the chain on the first failure — later replies have no parent.
            if (!ok || !url) {
                rows.push({ status: 'aborted', index: i + 1, id: '', url: '',
                    text: `Thread stopped at tweet ${i + 1}: ${result?.message ?? 'no URL returned'}` });
                break;
            }
            prevUrl = url;
        }
        return rows;
    },
});
