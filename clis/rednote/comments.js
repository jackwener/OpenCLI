/**
 * Rednote comments — international mirror of xiaohongshu/comments.
 * Reuses the DOM-extraction IIFE from `../xiaohongshu/comments.js`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { buildCommentsExtractJs } from '../xiaohongshu/comments.js';
import { buildNoteUrl, parseNoteId } from '../xiaohongshu/note-helpers.js';

const REDNOTE_SIGNED_URL_HINT = 'Pass a full rednote.com note URL with xsec_token from search results or user/profile context.';

function parseCommentLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between 1 and 50, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1 || parsed > 50) {
        throw new ArgumentError(`--limit must be between 1 and 50, got ${parsed}`);
    }
    return parsed;
}

cli({
    site: 'rednote',
    name: 'comments',
    access: 'read',
    description: 'Read comments from a rednote note (supports nested replies)',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Full rednote note URL with xsec_token' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 50)' },
        { name: 'with-replies', type: 'boolean', default: false, help: 'Include nested replies (楼中楼)' },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'time', 'is_reply', 'reply_to'],
    func: async (page, kwargs) => {
        const limit = parseCommentLimit(kwargs.limit);
        const withReplies = Boolean(kwargs['with-replies']);
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        await page.goto(buildNoteUrl(raw, {
            commandName: 'rednote comments',
            cookieRoot: 'rednote.com',
            signedUrlHint: REDNOTE_SIGNED_URL_HINT,
        }));
        await page.wait({ time: 2 + Math.random() * 3 });
        const data = await page.evaluate(buildCommentsExtractJs(withReplies));
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('rednote/comments', 'Unexpected evaluate response');
        }
        if (data.securityBlock) {
            throw new CommandExecutionError('Rednote security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.rednote.com', 'Note comments require login');
        }
        void noteId;
        const all = data.results ?? [];
        if (withReplies) {
            const limited = [];
            let topCount = 0;
            for (const c of all) {
                if (!c.is_reply)
                    topCount++;
                if (topCount > limit)
                    break;
                limited.push(c);
            }
            return limited.map((c, i) => ({ rank: i + 1, ...c }));
        }
        return all.slice(0, limit).map((c, i) => ({ rank: i + 1, ...c }));
    },
});
