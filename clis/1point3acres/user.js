/**
 * 一亩三分地 用户资料 — /bbs/space-uid-<uid>.html  or  /bbs/space-username-<name>.html
 *
 * Guest-visible fields: username, uid, user group, register/last-access times,
 * post/thread/digest counts, credits, rice (大米 — site currency), profile URL.
 * Users can be queried by numeric uid or by username (both routes are public).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchHtml, decodeEntities, BASE } from './utils.js';

cli({
    site: '1point3acres',
    name: 'user',
    access: 'read',
    description: '一亩三分地 用户空间（用户组 / 积分 / 大米 / 帖子数 等）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'who', required: true, positional: true, help: '用户名或 uid（纯数字按 uid 查，否则按用户名）' },
    ],
    columns: [
        'uid', 'username', 'group', 'credits', 'rice',
        'posts', 'threads', 'digests', 'registerTime', 'lastAccess', 'profileUrl',
    ],
    func: async (args) => {
        const who = String(args.who || '').trim();
        if (!who) throw new ArgumentError('who 不能为空', '传用户名或数字 uid');
        const url = /^\d+$/.test(who)
            ? `${BASE}/space-uid-${who}.html`
            : `${BASE}/space-username-${encodeURIComponent(who)}.html`;

        const html = await fetchHtml(url);
        if (/<title>提示信息/.test(html) && /(没有找到|不存在)/.test(html)) {
            throw new EmptyResultError('1point3acres user', `用户 "${who}" 不存在`);
        }

        const pick = (re) => {
            const m = html.match(re);
            return m ? decodeEntities(m[1].trim()) : '';
        };
        // <li>KEY: VAL</li>   — tolerant of optional <span>, colons fullwidth/半角, 颗/根/粒 suffixes.
        const pickLi = (label) => {
            const re = new RegExp(`<li>\\s*${label}[：:\\s]*(?:<[^>]+>)?\\s*([^<]+?)\\s*(?:<|$)`);
            const m = html.match(re);
            return m ? decodeEntities(m[1].trim()) : '';
        };

        const username =
            pick(/<p class="mtm[^"]*"[^>]*>\s*<a [^>]*>([^<]+?)<\/a>/) ||
            pick(/<title>([^<]+?)的个人资料/);
        const uid = pick(/uid=(\d+)/) || pick(/space-uid-(\d+)\.html/);
        const group = pickLi('用户组');
        const credits = pickLi('积分');
        const rice = pickLi('大米');
        const posts = pickLi('帖子数');
        const threads = pickLi('主题数');
        const digests = pickLi('精华数');
        const registerTime = pickLi('注册时间');
        const lastAccess = pickLi('最后访问');

        return [{
            uid,
            username,
            group,
            credits,
            rice,
            posts,
            threads,
            digests,
            registerTime,
            lastAccess,
            profileUrl: uid ? `${BASE}/space-uid-${uid}.html` : url,
        }];
    },
});
