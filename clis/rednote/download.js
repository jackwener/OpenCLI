/**
 * Rednote download — international mirror of xiaohongshu/download.
 * Reuses the DOM-extraction IIFE from `../xiaohongshu/download.js`; that
 * IIFE's CDN allowlist already accepts rednote-hosted media URLs.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { buildDownloadExtractJs } from '../xiaohongshu/download.js';
import { buildNoteUrl, parseNoteId } from '../xiaohongshu/note-helpers.js';

const REDNOTE_SIGNED_URL_HINT = 'Pass a full rednote.com note URL with xsec_token from search results or user/profile context.';

cli({
    site: 'rednote',
    name: 'download',
    access: 'read',
    description: 'Download images and videos from a rednote note',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', positional: true, required: true, help: 'Full rednote note URL with xsec_token' },
        { name: 'output', default: './rednote-downloads', help: 'Output directory' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const rawInput = String(kwargs['note-id']);
        const output = kwargs.output;
        const noteId = parseNoteId(rawInput);
        await page.goto(buildNoteUrl(rawInput, {
            commandName: 'rednote download',
            cookieRoot: 'rednote.com',
            signedUrlHint: REDNOTE_SIGNED_URL_HINT,
        }));
        await page.wait({ time: 1 + Math.random() * 2 });
        const data = await page.evaluate(buildDownloadExtractJs(noteId));
        if (data?.securityBlock) {
            throw new CommandExecutionError('Rednote security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(rawInput)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (!data || !data.media || data.media.length === 0) {
            throw new EmptyResultError('rednote/download', 'No downloadable media found on this rednote note.');
        }
        const cookies = formatCookieHeader(await page.getCookies({ url: 'https://www.rednote.com' }));
        const resolvedNoteId = typeof data.noteId === 'string' && data.noteId.trim()
            ? data.noteId.trim()
            : noteId;
        return downloadMedia(data.media, {
            output,
            subdir: resolvedNoteId,
            cookies,
            filenamePrefix: resolvedNoteId,
            timeout: 60000,
        });
    },
});
