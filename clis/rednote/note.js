/**
 * Rednote note — international mirror of xiaohongshu/note.
 * Reuses the DOM-extraction IIFE from `../xiaohongshu/note.js`; only the
 * web host and cookie root differ.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { NOTE_EXTRACT_JS } from '../xiaohongshu/note.js';
import { buildNoteUrl, parseNoteId } from '../xiaohongshu/note-helpers.js';

const REDNOTE_SIGNED_URL_HINT = 'Pass a full rednote.com note URL with xsec_token from search results or user/profile context.';

cli({
    site: 'rednote',
    name: 'note',
    access: 'read',
    description: 'Read note body and engagement counts from a rednote note',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Full rednote note URL with xsec_token' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        const url = buildNoteUrl(raw, {
            commandName: 'rednote note',
            cookieRoot: 'rednote.com',
            signedUrlHint: REDNOTE_SIGNED_URL_HINT,
        });
        await page.goto(url);
        await page.wait({ time: 2 + Math.random() * 3 });
        const data = await page.evaluate(NOTE_EXTRACT_JS);
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('rednote/note', 'Unexpected evaluate response');
        }
        if (data.securityBlock) {
            throw new CommandExecutionError('Rednote security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.rednote.com', 'Note content requires login');
        }
        if (data.notFound) {
            throw new EmptyResultError('rednote/note', `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
        }
        const d = data;
        const numOrZero = (v) => /^\d+/.test(v) ? v : '0';
        if (!d.title && !d.author) {
            throw new EmptyResultError('rednote/note', 'The note page loaded without visible content. The note may be deleted or restricted.');
        }
        const rows = [
            { field: 'title', value: d.title || '' },
            { field: 'author', value: d.author || '' },
            { field: 'content', value: d.desc || '' },
            { field: 'likes', value: numOrZero(d.likes || '') },
            { field: 'collects', value: numOrZero(d.collects || '') },
            { field: 'comments', value: numOrZero(d.comments || '') },
        ];
        if (d.tags?.length) {
            rows.push({ field: 'tags', value: d.tags.join(', ') });
        }
        return rows;
    },
});
