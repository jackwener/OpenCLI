import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { fetchJson, getSelfUid, resolveUid } from './utils.js';
cli({
    site: 'bilibili',
    name: 'following',
    description: '获取 Bilibili 用户的关注列表',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', positional: true, required: false, help: '目标用户 ID（默认为当前登录用户）' },
        { name: 'page', type: 'int', required: false, default: 1, help: '页码' },
        { name: 'limit', type: 'int', required: false, default: 50, help: '每页数量 (最大 50)' },
    ],
    columns: ['mid', 'name', 'sign', 'following', 'fans'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for bilibili following');
        // 1. Resolve UID (default to self)
        const uid = kwargs.uid
            ? await resolveUid(page, kwargs.uid)
            : await getSelfUid(page);
        const pn = kwargs.page ?? 1;
        const ps = Math.min(kwargs.limit ?? 50, 50);
        // 2. Fetch following list (standard Cookie API, no Wbi signing needed)
        const payload = await fetchJson(page, `https://api.bilibili.com/x/relation/followings?vmid=${uid}&pn=${pn}&ps=${ps}&order=desc`);
        if (payload.code !== 0) {
            throw new CommandExecutionError(`获取关注列表失败: ${payload.message} (${payload.code})`);
        }
        const list = payload.data?.list || [];
        if (list.length === 0) {
            return [{ mid: '-', name: `共 ${payload.data?.total ?? 0} 人关注，当前页无数据`, sign: '', following: '', fans: '' }];
        }
        // 3. Map to output
        return list.map((u) => ({
            mid: u.mid,
            name: u.uname,
            sign: (u.sign || '').slice(0, 40),
            following: u.attribute === 6 ? '互相关注' : '已关注',
            fans: u.official_verify?.desc || '',
        }));
    },
});
