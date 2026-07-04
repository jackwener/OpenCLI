// nodeseek me — full profile of the logged-in NodeSeek account.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { readCurrentUser } from './client.js';

/** Project the SSR user object into the `me` row shape. */
function mapMe(u) {
    return {
        member_id: u.member_id,
        member_name: u.member_name,
        rank: u.rank,
        coin: u.coin,
        stardust: u.stardust,
        nPost: u.nPost,
        nComment: u.nComment,
        follows: u.follows,
        fans: u.fans,
        collectionCount: u.collectionCount,
        bio: u.bio || '',
        created_at: u.created_at,
    };
}

cli({
    site: 'nodeseek',
    name: 'me',
    access: 'read',
    description: 'Full profile of the logged-in NodeSeek account (rank/coin/post counts)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['member_id', 'member_name', 'rank', 'coin', 'stardust', 'nPost', 'nComment', 'follows', 'fans', 'collectionCount', 'bio', 'created_at'],
    func: async (page) => {
        const u = await readCurrentUser(page);
        if (!u || !u.member_id)
            throw new AuthRequiredError('nodeseek.com', 'Not logged in to NodeSeek');
        return [mapMe(u)];
    },
});

export const __test__ = { mapMe };
