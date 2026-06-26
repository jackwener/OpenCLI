import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseZhihuUser } from './user-arg.js';
import { fetchZhihuList, validateLimit } from './paginate.js';

const INCLUDE = 'data[*].voteup_count,comment_count,created_time,question';

cli({
    site: 'zhihu',
    name: 'user-answers',
    access: 'read',
    description: '知乎某用户的回答列表',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', type: 'string', required: true, positional: true, help: 'User url_token or people URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of answers to return (max 1000)' },
    ],
    columns: ['rank', 'question', 'votes', 'comments', 'created', 'url'],
    func: async (page, kwargs) => {
        const slug = parseZhihuUser(kwargs.user);
        const limit = validateLimit(kwargs.limit);
        await page.goto('https://www.zhihu.com');
        const first = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(slug)}/answers?limit=20&offset=0&include=${encodeURIComponent(INCLUDE)}`;
        const items = await fetchZhihuList(page, first, limit, 'user answers');
        return items.map((a, i) => {
            const q = a.question || {};
            if (!a.id || !q.id || !q.title) {
                throw new CommandExecutionError('Zhihu user answers returned malformed row identity');
            }
            return {
                rank: i + 1,
                question: String(q.title || ''),
                votes: a.voteup_count ?? a.reaction?.statistics?.like_count ?? 0,
                comments: a.comment_count ?? 0,
                created: a.created_time ?? a.created ?? 0,
                url: q.id && a.id ? `https://www.zhihu.com/question/${q.id}/answer/${a.id}` : '',
            };
        });
    },
});
