// Adapted from ZhongQuinnKing/opencli-douyin-detail (MIT). See ../detail.LICENSE.
// Video id / URL / share-link resolution shared by detail, comments and mix.
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const ID = /^\d{16,20}$/;
const HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com', 'www.iesdouyin.com', 'iesdouyin.com']);
function trustedUrl(input, base) {
    let url;
    try { url = new URL(input, base); }
    catch { throw new ArgumentError('Expected a Douyin video ID or URL'); }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
        throw new ArgumentError('Only HTTPS Douyin share/video URLs are supported');
    }
    return url;
}
export function extractVideoId(input) {
    const text = String(input ?? '').trim();
    if (ID.test(text)) return text;
    const url = trustedUrl(text);
    if (url.hostname === 'v.douyin.com') return '';
    const pathId = url.pathname.match(/^\/(?:share\/)?video\/(\d{16,20})\/?$/)?.[1];
    const modalId = url.searchParams.get('modal_id');
    return pathId || (ID.test(modalId ?? '') ? modalId : '');
}
export async function resolveToId(input) {
    const text = String(input ?? '').trim();
    let id = extractVideoId(text);
    if (id) return id;
    let url = trustedUrl(text);
    if (url.hostname !== 'v.douyin.com') throw new ArgumentError('No video ID in Douyin URL');
    const visited = new Set();
    for (let hop = 0; hop < 6; hop++) {
        if (visited.has(url.href)) throw new CommandExecutionError('Douyin share URL redirect loop');
        visited.add(url.href);
        let res;
        try {
            res = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
            await res.body?.cancel();
        } catch (error) {
            throw new CommandExecutionError(`Douyin share URL request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (![301, 302, 303, 307, 308].includes(res.status)) {
            throw new CommandExecutionError(`Douyin share URL did not redirect (HTTP ${res.status})`);
        }
        const location = res.headers.get('location');
        if (!location) throw new CommandExecutionError('Douyin share redirect has no Location');
        url = trustedUrl(location, url);
        id = extractVideoId(url.href);
        if (id) return id;
    }
    throw new CommandExecutionError('Douyin share URL exceeded six redirects');
}
