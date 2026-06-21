import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseZhihuUser } from './user-arg.js';
import { fetchZhihuList, validateLimit } from './paginate.js';

const INCLUDE = 'data[*].voteup_count,comment_count';

cli({
    site: 'zhihu',
    name: 'user-articles',
    access: 'read',
    description: '知乎某用户的文章/专栏列表',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', type: 'string', required: true, positional: true, help: 'User url_token or people URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of articles to return (max 1000)' },
    ],
    columns: ['rank', 'title', 'votes', 'comments', 'created', 'url'],
    func: async (page, kwargs) => {
        const slug = parseZhihuUser(kwargs.user);
        const limit = validateLimit(kwargs.limit);
        await page.goto('https://www.zhihu.com');
        const first = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(slug)}/articles?limit=20&offset=0&include=${encodeURIComponent(INCLUDE)}`;
        const items = await fetchZhihuList(page, first, limit, 'user articles');
        return items.map((a, i) => {
            if (!a.id || !a.title) {
                throw new CommandExecutionError('Zhihu user articles returned malformed row identity');
            }
            return {
                rank: i + 1,
                title: String(a.title || ''),
                votes: a.voteup_count ?? 0,
                comments: a.comment_count ?? 0,
                created: a.created ?? a.updated ?? 0,
                url: `https://zhuanlan.zhihu.com/p/${a.id}`,
            };
        });
    },
});
