import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseZhihuUser } from './user-arg.js';
import { fetchZhihuList, validateLimit } from './paginate.js';

const INCLUDE = 'data[*].follower_count,headline,answer_count,articles_count';

cli({
    site: 'zhihu',
    name: 'following',
    access: 'read',
    description: '知乎某用户关注的人列表',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', type: 'string', required: true, positional: true, help: 'User url_token or people URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of followees to return (max 1000)' },
    ],
    columns: ['rank', 'name', 'url_token', 'headline', 'followers', 'url'],
    func: async (page, kwargs) => {
        const slug = parseZhihuUser(kwargs.user);
        const limit = validateLimit(kwargs.limit);
        await page.goto('https://www.zhihu.com');
        const first = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(slug)}/followees?limit=20&offset=0&include=${encodeURIComponent(INCLUDE)}`;
        const items = await fetchZhihuList(page, first, limit, 'following');
        return items.map((u, i) => {
            if (!u.url_token || !u.name) {
                throw new CommandExecutionError('Zhihu following returned malformed row identity');
            }
            return {
                rank: i + 1,
                name: String(u.name || ''),
                url_token: String(u.url_token || ''),
                headline: String(u.headline || ''),
                followers: u.follower_count ?? 0,
                url: `https://www.zhihu.com/people/${u.url_token}`,
            };
        });
    },
});
