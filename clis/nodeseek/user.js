// nodeseek user — profile of any NodeSeek member by id.
//
// Source: GET /api/account/getInfo/<member_id> -> { success, detail: {...} }.
// Strategy.COOKIE: the endpoint sits behind Cloudflare and is fetched with the
// logged-in session (credentials:'include'), so it needs an authenticated browser.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchNsJson } from './client.js';

/** Validate and normalize a member id argument. */
function parseMemberId(raw) {
    const id = String(raw ?? '').trim();
    if (!/^\d+$/.test(id))
        throw new ArgumentError('nodeseek user', `member id must be numeric, got "${raw}"`);
    return id;
}

/** Project an /api/account/getInfo detail object into the `user` row shape. */
function mapUser(d) {
    return {
        member_id: d.member_id,
        member_name: d.member_name,
        rank: d.rank,
        coin: d.coin,
        nPost: d.nPost,
        nComment: d.nComment,
        follows: d.follows,
        fans: d.fans,
        bio: d.bio || '',
        created_at: d.created_at_str || d.created_at,
        profile: `https://www.nodeseek.com/space/${d.member_id}`,
    };
}

cli({
    site: 'nodeseek',
    name: 'user',
    access: 'read',
    description: 'Profile of a NodeSeek member by id (requires login)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', positional: true, required: true, help: 'NodeSeek member id (numeric; see latest author / space links)' },
    ],
    columns: ['member_id', 'member_name', 'rank', 'coin', 'nPost', 'nComment', 'follows', 'fans', 'bio', 'created_at', 'profile'],
    func: async (page, kwargs) => {
        const id = parseMemberId(kwargs.id);
        const data = await fetchNsJson(page, `/api/account/getInfo/${id}`);
        const d = data?.detail;
        if (!d || !d.member_id)
            throw new EmptyResultError('nodeseek user', `Member ${id} not found`);
        return [mapUser(d)];
    },
});

export const __test__ = { parseMemberId, mapUser };
