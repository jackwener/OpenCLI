import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseZhihuUser } from './user-arg.js';
import { unwrapEvaluateResult } from './paginate.js';

const INCLUDE = 'follower_count,following_count,answer_count,articles_count,question_count,voteup_count,thanked_count,favorited_count,headline,gender';

cli({
    site: 'zhihu',
    name: 'user',
    access: 'read',
    description: '知乎用户主页资料（粉丝/关注/回答/文章/获赞数）',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', type: 'string', required: true, positional: true, help: 'User url_token or people URL, e.g. wen-jie-16-47' },
    ],
    columns: ['url_token', 'name', 'headline', 'followers', 'following', 'answers', 'articles', 'voteup', 'url'],
    func: async (page, kwargs) => {
        const slug = parseZhihuUser(kwargs.user);
        await page.goto('https://www.zhihu.com');
        const apiUrl = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(slug)}?include=${encodeURIComponent(INCLUDE)}`;
        const data = unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        try {
          const r = await fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' });
          if (!r.ok) return { __httpError: r.status };
          return await r.json();
        } catch (err) {
          return { __fetchError: err?.message || String(err) };
        }
      })()
    `));
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.__httpError || data.__fetchError) {
            const status = data?.__httpError;
            if (status === 401 || status === 403) {
                throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu user profile');
            }
            if (status === 404) {
                throw new EmptyResultError('zhihu user', `No Zhihu user was found for ${slug}.`);
            }
            throw new CommandExecutionError(status ? `Zhihu user request failed (HTTP ${status})` : 'Zhihu user request failed', data?.__fetchError ? String(data.__fetchError) : 'Try again later or rerun with -v');
        }
        if (!data.url_token || !data.id || !data.name) {
            throw new CommandExecutionError('Zhihu user response missing identity fields', 'Zhihu may have changed its API shape');
        }
        return [{
            url_token: String(data.url_token || ''),
            name: String(data.name || ''),
            headline: String(data.headline || ''),
            followers: data.follower_count ?? 0,
            following: data.following_count ?? 0,
            answers: data.answer_count ?? 0,
            articles: data.articles_count ?? 0,
            voteup: data.voteup_count ?? 0,
            url: data.url_token ? `https://www.zhihu.com/people/${data.url_token}` : '',
        }];
    },
});
