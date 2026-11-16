import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const PROFILE_COLUMNS = ['user_id', 'sec_uid', 'nickname', 'bio', 'avatar_url', 'follower_count', 'following_count', 'liked_count', 'post_count', 'follow_status', 'ip_location', 'profile_url', 'posts'];

export function trustedProfileId(input, host, prefix, pattern) {
    const raw = String(input ?? '').trim();
    if (pattern.test(raw)) return raw;
    try {
        const url = new URL(raw);
        const candidate = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length).replace(/\/$/, '') : '';
        if (url.protocol === 'https:' && url.hostname === host && !url.port && !url.username && !url.password && pattern.test(candidate)) return candidate;
    } catch { /* Bare IDs were checked first. */ }
    throw new ArgumentError(`Expected a valid ID or exact https://${host}${prefix}<id> profile URL`);
}

export function publicCount(value, label) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    const match = typeof value === 'string' ? value.trim().match(/^(\d+(?:\.\d+)?)(万|亿|w)?$/i) : null;
    if (!match) throw new CommandExecutionError(`${label}: invalid public count`);
    const count = Number(match[1]) * ({ '万': 10000, '亿': 100000000, w: 10000 }[match[2]?.toLowerCase()] ?? 1);
    if (!Number.isSafeInteger(count) || count < 0) throw new CommandExecutionError(`${label}: invalid public count`);
    return count;
}

export function assertProfileLocation(observedUrl, expectedUrl) {
    let observed;
    try { observed = new URL(observedUrl); } catch { throw new CommandExecutionError('Profile URL was not available'); }
    const expected = new URL(expectedUrl);
    if (observed.origin !== expected.origin || observed.pathname.replace(/\/$/, '') !== expected.pathname) {
        throw new CommandExecutionError('Browser navigated away from the requested public profile');
    }
}
