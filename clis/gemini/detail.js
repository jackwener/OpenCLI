import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    GEMINI_APP_URL,
    GEMINI_DOMAIN,
    ensureGeminiPage,
    getGeminiConversationList,
    getGeminiVisibleTurns,
    resolveGeminiConversationForQuery,
} from './utils.js';
import { extractGeminiId } from './history.js';

/**
 * Resolve the caller-supplied `<id>` argument into an absolute
 * conversation URL. Accepts:
 *   1. A bare conversation id (`b8368a89d4242e5f`)
 *   2. A relative `/app/<id>` path
 *   3. A full `https://gemini.google.com/app/<id>` URL
 *   4. A sidebar title — looked up exactly first, then by substring
 */
async function resolveTargetUrl(page, query) {
    const raw = String(query || '').trim();
    if (!raw) {
        throw new ArgumentError('id', 'must be a conversation id, /app/<id> URL, or sidebar title');
    }

    // Unambiguously id-shaped inputs (URL, /app/<id> path, or 16-hex bare id)
    // skip the sidebar lookup. Generic alphanumeric strings always go through
    // title-matching first so a chat called "Empire study" doesn't get treated
    // as the literal conversation id "Empire study".
    const directId = extractGeminiId(raw);
    const looksLikeId =
        raw.startsWith('http') ||
        raw.startsWith('/app/') ||
        /^[a-f0-9]{16,}$/i.test(raw);
    if (directId && looksLikeId) {
        return `${GEMINI_APP_URL}/${directId}`;
    }

    const conversations = await getGeminiConversationList(page);
    const match = resolveGeminiConversationForQuery(conversations, raw, 'contains');
    if (!match || !match.Url) {
        throw new EmptyResultError(
            'gemini detail',
            `No sidebar conversation matched "${raw}". Try the exact id from \`opencli gemini history\` instead.`,
        );
    }
    return match.Url;
}

export const detailCommand = cli({
    site: 'gemini',
    name: 'detail',
    access: 'read',
    description: 'Open a Gemini web conversation by id, URL, or sidebar title and read its turns',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation id, /app/<id> URL, or sidebar title' },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        await ensureGeminiPage(page);
        const target = await resolveTargetUrl(page, kwargs?.id);
        await page.goto(target, { waitUntil: 'load', settleMs: 2500 });
        const turns = await getGeminiVisibleTurns(page);
        if (!Array.isArray(turns) || turns.length === 0) {
            throw new EmptyResultError(
                'gemini detail',
                `No turns were visible after navigating to ${target}.`,
            );
        }
        return turns.map((t, idx) => ({
            Index: idx + 1,
            Role: t.Role || 'System',
            Text: t.Text || '',
        }));
    },
});
