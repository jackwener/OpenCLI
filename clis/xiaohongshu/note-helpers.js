import { ArgumentError } from '@jackwener/opencli/errors';

/** Side-effect-free helpers shared by xiaohongshu note and comments commands. */
/** Extract a bare note ID from a full URL or raw ID string. */
export function parseNoteId(input) {
    const trimmed = input.trim();
    const match = trimmed.match(/\/(?:explore|note|search_result|discovery\/item)\/([a-f0-9]+)|\/user\/profile\/[^/?#]+\/([a-f0-9]+)/i);
    return match ? (match[1] || match[2]) : trimmed;
}

export const XHS_SIGNED_URL_HINT = 'Pass a full Xiaohongshu note URL with xsec_token from search results or user/profile context.';

function isShortLink(input) {
    return /^https?:\/\/xhslink\.com\//i.test(input);
}

function isHostMatch(hostname, cookieRoot) {
    const normalized = hostname.toLowerCase();
    return normalized === cookieRoot || normalized.endsWith('.' + cookieRoot);
}

function isSupportedNotePath(pathname) {
    return /^\/(?:explore|note|search_result|discovery\/item)\/[a-f0-9]+(?:[/?#]|$)/i.test(pathname)
        || /^\/user\/profile\/[^/?#]+\/[a-f0-9]+(?:[/?#]|$)/i.test(pathname);
}

/**
 * Build the best navigation URL for a note.
 *
 * XHS note detail pages now require a valid signed URL for reliable access.
 * Bare note IDs no longer resolve deterministically, so callers must provide
 * a full note URL with xsec_token or, for downloads only, an xhslink short link.
 *
 * `options.cookieRoot` overrides the default `xiaohongshu.com` cookie root —
 * the rednote adapter passes `'rednote.com'` so the same validator accepts
 * `www.rednote.com` URLs without duplicating this function.
 * `options.signedUrlHint` overrides the default hint surfaced on rejection.
 */
export function buildNoteUrl(input, options = {}) {
    const {
        allowShortLink = false,
        commandName = 'xiaohongshu note',
        cookieRoot = 'xiaohongshu.com',
        signedUrlHint = XHS_SIGNED_URL_HINT,
    } = options;
    const trimmed = input.trim();
    const message = `${commandName} now requires a full signed URL`;
    const hint = allowShortLink
        ? `${signedUrlHint} For downloads, xhslink short links are also supported.`
        : signedUrlHint;

    if (/^https?:\/\//.test(trimmed)) {
        if (isShortLink(trimmed)) {
            if (allowShortLink)
                return trimmed;
            throw new ArgumentError(message, hint);
        }
        try {
            const url = new URL(trimmed);
            const xsecToken = url.searchParams.get('xsec_token')?.trim();
            if (isHostMatch(url.hostname, cookieRoot) && isSupportedNotePath(url.pathname) && xsecToken) {
                return trimmed;
            }
        }
        catch { }
        throw new ArgumentError(message, hint);
    }
    throw new ArgumentError(message, hint);
}
