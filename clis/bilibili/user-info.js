/**
 * Bilibili user-info — one user's public card: name / sign / fans / following /
 * level / avatar, for enriching discovery candidates.
 *
 * Two cookie APIs:
 *   /x/space/wbi/acc/info?mid=   (Wbi-signed) → name, sign, level, face, official, vip
 *   /x/relation/stat?vmid=       (plain)      → follower, following
 *
 * The relation call is separate because acc/info does not carry counts.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiGet, fetchJson, httpsUrl, isAuthLikeBilibiliError, resolveUid } from './utils.js';
import { parseSpaceMidUrl } from './relation.js';

export const BILIBILI_USER_INFO_COLUMNS = ['mid', 'name', 'sign', 'fans', 'following', 'level', 'avatar', 'official', 'vip', 'url'];

function toCount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Combine acc/info and relation/stat payload data into the documented row. */
export function mapBilibiliUserInfo(mid, info, stat) {
    if (!info || typeof info !== 'object') {
        throw new CommandExecutionError('Bilibili acc/info returned malformed data');
    }
    const official = info.official && typeof info.official === 'object' ? info.official : {};
    const vip = info.vip && typeof info.vip === 'object' ? info.vip : {};
    return {
        mid: String(info.mid ?? mid),
        name: typeof info.name === 'string' ? info.name : '',
        sign: typeof info.sign === 'string' ? info.sign : '',
        fans: toCount(stat?.follower),
        following: toCount(stat?.following),
        level: toCount(info.level),
        avatar: httpsUrl(info.face) || null,
        official: typeof official.title === 'string' && official.title ? official.title : null,
        vip: toCount(vip.status) === 1,
        url: `https://space.bilibili.com/${String(info.mid ?? mid)}`,
    };
}

function normalizeMidInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) {
        throw new ArgumentError('bilibili user-info requires a mid, space URL, or username', 'Example: opencli bilibili user-info 946974');
    }
    return parseSpaceMidUrl(text) || text;
}

cli({
    site: 'bilibili',
    name: 'user-info',
    access: 'read',
    description: 'Bilibili 用户信息（昵称 / 签名 / 粉丝 / 关注 / 等级 / 头像）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'mid', positional: true, required: true, help: '用户 mid、space.bilibili.com/<mid> 链接，或用户名（按搜索首个结果解析）' },
    ],
    columns: BILIBILI_USER_INFO_COLUMNS,
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for bilibili user-info');
        const mid = await resolveUid(page, normalizeMidInput(kwargs.mid));
        const infoPayload = await apiGet(page, '/x/space/wbi/acc/info', { params: { mid }, signed: true });
        if (!infoPayload || typeof infoPayload !== 'object' || !Object.hasOwn(infoPayload, 'code')) {
            throw new CommandExecutionError('Bilibili acc/info API returned a malformed payload');
        }
        if (infoPayload.code !== 0) {
            const message = infoPayload.message ?? 'unknown error';
            if (infoPayload.code === -404) {
                throw new EmptyResultError('bilibili user-info', `User ${mid} was not found (${message}).`);
            }
            if (isAuthLikeBilibiliError(infoPayload.code, message) || infoPayload.code === -352) {
                throw new CommandExecutionError(`Bilibili acc/info rejected the request: ${message} (${infoPayload.code})`, 'Bilibili risk control (-352) or login state; retry from a logged-in browser session.');
            }
            throw new CommandExecutionError(`Bilibili acc/info API failed: ${message} (${infoPayload.code})`);
        }
        const statPayload = await fetchJson(page, `https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(mid)}`);
        const stat = statPayload && typeof statPayload === 'object' && statPayload.code === 0 ? statPayload.data : null;
        return [mapBilibiliUserInfo(mid, infoPayload.data, stat)];
    },
});

export const __test__ = { mapBilibiliUserInfo, normalizeMidInput };
