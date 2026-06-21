import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseZhihuUser } from './user-arg.js';
import { fetchZhihuList, validateLimit } from './paginate.js';

cli({
    site: 'zhihu',
    name: 'pins',
    access: 'read',
    description: '知乎某用户的想法（短内容）列表',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', type: 'string', required: true, positional: true, help: 'User url_token or people URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of pins to return (max 1000)' },
    ],
    columns: ['rank', 'excerpt', 'type', 'likes', 'comments', 'reposts', 'created', 'url'],
    func: async (page, kwargs) => {
        const slug = parseZhihuUser(kwargs.user);
        const limit = validateLimit(kwargs.limit);
        await page.goto('https://www.zhihu.com');
        const first = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(slug)}/pins?limit=20&offset=0`;
        const items = await fetchZhihuList(page, first, limit, 'pins');
        return items.map((p, i) => {
            const firstContent = Array.isArray(p.content) ? p.content[0] : null;
            if (!p.id || !p.excerpt_title) {
                throw new CommandExecutionError('Zhihu pins returned malformed row identity');
            }
            return {
                rank: i + 1,
                excerpt: String(p.excerpt_title || ''),
                type: String(firstContent?.type || ''),
                likes: p.like_count ?? p.reaction_count ?? 0,
                comments: p.comment_count ?? 0,
                reposts: p.repin_count ?? 0,
                created: p.created ?? p.updated ?? 0,
                url: `https://www.zhihu.com/pin/${p.id}`,
            };
        });
    },
});
