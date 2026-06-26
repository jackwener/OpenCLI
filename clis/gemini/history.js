import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    GEMINI_DOMAIN,
    ensureGeminiPage,
    getGeminiConversationList,
} from './utils.js';

/**
 * Pull the Gemini conversation id out of a `/app/<id>` URL or accept the
 * raw id directly. Returns '' when nothing usable is present.
 */
function extractGeminiId(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw, 'https://gemini.google.com');
        const m = u.pathname.match(/^\/app\/([A-Za-z0-9_-]+)/);
        if (m) return m[1];
    } catch {
        // Not a URL — fall through to direct id treatment.
    }
    // Accept a bare id ('app/<id>' or just '<id>').
    const trimmed = raw.replace(/^.*\/app\//, '').replace(/\/.*$/, '');
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : '';
}

export const historyCommand = cli({
    site: 'gemini',
    name: 'history',
    access: 'read',
    description: 'List visible Gemini web conversation history from the sidebar',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const rawLimit = Number(kwargs?.limit ?? 20);
        if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
            throw new ArgumentError('limit', 'must be a positive integer ≤ 200');
        }
        await ensureGeminiPage(page);
        const conversations = await getGeminiConversationList(page);
        if (!conversations.length) {
            throw new EmptyResultError(
                'gemini history',
                'No Gemini conversation links were visible in the sidebar. Open the sidebar and confirm at least one chat is listed under Recents.',
            );
        }
        // The sidebar mixes a "New chat" affordance (URL = /app, no id) into
        // the same link list; drop entries that don't resolve to a real
        // conversation id so callers get a clean conversation list.
        const rows = conversations
            .map((row) => ({ id: extractGeminiId(row.Url), title: row.Title || '', url: row.Url || '' }))
            .filter((row) => row.id);
        return rows.slice(0, rawLimit).map((row, idx) => ({
            Index: idx + 1,
            Id: row.id,
            Title: row.title,
            Url: row.url,
        }));
    },
});

export { extractGeminiId };
