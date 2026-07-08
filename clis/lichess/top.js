// lichess top — top-N leaderboard for a given perf type.
//
// Hits `/api/player/top/<n>/<perf>`. Returns the leaderboard rows; usernames
// round-trip into `lichess user` for full profile detail.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LICHESS_BASE, lichessFetch, requireBoundedInt, requirePerf } from './utils.js';

cli({
    site: 'lichess',
    name: 'top',
    access: 'read',
    description: 'Top-N Lichess leaderboard for a perf type (bullet/blitz/rapid/classical/...)',
    domain: 'lichess.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'perf', positional: true, required: true, help: 'Perf type (bullet, blitz, rapid, classical, ultraBullet, chess960, ...)' },
        { name: 'limit', type: 'int', default: 10, help: 'Top-N rows (1-200)' },
    ],
    columns: ['rank', 'username', 'id', 'title', 'rating', 'progress', 'patron', 'url'],
    func: async (args) => {
        const perf = requirePerf(args.perf);
        const limit = requireBoundedInt(args.limit, 10, 200);
        const url = `${LICHESS_BASE}/api/player/top/${limit}/${encodeURIComponent(perf)}`;
        const body = await lichessFetch(url, 'lichess top');
        const list = Array.isArray(body?.users) ? body.users : [];
        if (!list.length) {
            throw new EmptyResultError('lichess top', `Lichess returned no leaderboard rows for perf "${perf}".`);
        }
        return list.slice(0, limit).map((u, i) => {
            const username = typeof u?.username === 'string' ? u.username : '';
            const perfBlock = u?.perfs && typeof u.perfs === 'object' ? u.perfs[perf] ?? {} : {};
            return {
                rank: i + 1,
                username,
                id: typeof u?.id === 'string' ? u.id : null,
                title: typeof u?.title === 'string' ? u.title : null,
                rating: typeof perfBlock.rating === 'number' ? perfBlock.rating : null,
                progress: typeof perfBlock.progress === 'number' ? perfBlock.progress : null,
                patron: u?.patron === true,
                url: username ? `${LICHESS_BASE}/@/${encodeURIComponent(username)}/perf/${encodeURIComponent(perf)}` : '',
            };
        });
    },
});
