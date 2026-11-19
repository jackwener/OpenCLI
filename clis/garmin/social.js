import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GC, ensureGarmin, garminApi, getProfile, normalizeDisplayName, requireExecute } from './utils.js';
const SEARCH_QS = 'image-version=PROFILE&image-version=PROFILE_FRIEND&displayMutedStatus=true';
function flattenStatus(fs, fallback) {
    if (fs && typeof fs === 'object')
        return fs.relationshipStatus || (fs.sentRequest ? 'REQUEST_SENT' : '') || '';
    return fs || fallback || '';
}
function socialRow(rank, c) {
    return {
        rank,
        name: c.fullName || c.displayName || '',
        display_name: c.displayName || '',
        location: c.location || '',
        follow_status: flattenStatus(c.followStatus, c.userConnectionStatus),
        url: c.displayName ? `${GC}/modern/profile/${c.displayName}` : '',
    };
}
// ── garmin search (find athletes by name) ───────────────────────────────
//
// The "Find Friends" box POSTs to usersearch-service/search/v3 with a
// form body (keyword/start/limit) and returns a profileList.
cli({
    site: 'garmin',
    name: 'search',
    access: 'read',
    description: 'Search Garmin Connect athletes by name',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'keyword', type: 'str', positional: true, required: true, help: 'Name to search' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'name', 'display_name', 'location', 'follow_status', 'url'],
    func: async (page, kwargs) => {
        const keyword = String(kwargs.keyword || '').trim();
        const limit = kwargs.limit || 20;
        if (!keyword)
            throw new EmptyResultError('garmin search', 'Search keyword is empty.');
        await ensureGarmin(page);
        const data = await garminApi(page, `/gc-api/usersearch-service/search/v3?${SEARCH_QS}`, {
            method: 'POST',
            form: { keyword, start: 1, limit },
        });
        const list = (data && data.profileList) || [];
        if (!list.length)
            throw new EmptyResultError('garmin search', `No athletes found for "${keyword}".`);
        return list.slice(0, limit).map((c, i) => socialRow(i + 1, c));
    },
});
// ── garmin following / followers / connections ──────────────────────────
cli({
    site: 'garmin',
    name: 'following',
    access: 'read',
    description: 'Athletes you follow',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number to return' },
    ],
    columns: ['rank', 'name', 'display_name', 'location', 'follow_status', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/follower-service/follow/followings/${sp.displayName}?start=0&limit=${limit}`);
        const list = Array.isArray(data) ? data : (data && (data.userConnections || data.items)) || [];
        if (!list.length)
            throw new EmptyResultError('garmin following', 'You are not following anyone yet.');
        return list.slice(0, limit).map((c, i) => socialRow(i + 1, c));
    },
});
cli({
    site: 'garmin',
    name: 'followers',
    access: 'read',
    description: 'Athletes who follow you',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number to return' },
    ],
    columns: ['rank', 'name', 'display_name', 'location', 'follow_status', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/follower-service/follow/followers/${sp.displayName}?start=0&limit=${limit}`);
        const list = Array.isArray(data) ? data : (data && (data.userConnections || data.items)) || [];
        if (!list.length)
            throw new EmptyResultError('garmin followers', 'You have no followers yet.');
        return list.slice(0, limit).map((c, i) => socialRow(i + 1, c));
    },
});
// ── garmin follow / unfollow (write) ────────────────────────────────────
cli({
    site: 'garmin',
    name: 'follow',
    access: 'write',
    description: 'Follow a Garmin athlete (requires --execute)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete display id (from `garmin search`) or profile URL' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually follow (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'display_name'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'follow this athlete');
        const dn = normalizeDisplayName(kwargs.athlete);
        if (!dn)
            throw new EmptyResultError('garmin follow', `Could not parse an athlete display id from "${kwargs.athlete}".`);
        await ensureGarmin(page);
        await garminApi(page, `/gc-api/follower-service/follow/followings/${dn}`, { method: 'POST' });
        return [{ status: 'success', message: 'Now following', display_name: dn }];
    },
});
cli({
    site: 'garmin',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow a Garmin athlete (requires --execute)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete display id or profile URL' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually unfollow (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'display_name'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'unfollow this athlete');
        const dn = normalizeDisplayName(kwargs.athlete);
        if (!dn)
            throw new EmptyResultError('garmin unfollow', `Could not parse an athlete display id from "${kwargs.athlete}".`);
        await ensureGarmin(page);
        await garminApi(page, `/gc-api/follower-service/follow/followings/${dn}`, { method: 'DELETE' });
        return [{ status: 'success', message: 'Unfollowed', display_name: dn }];
    },
});
