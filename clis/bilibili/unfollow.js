/**
 * Bilibili unfollow — removes a follow relation via the official write API.
 * Mirror of follow.js with act=2. If the viewer is not currently following the
 * target, the API call is skipped and `not-following` is returned without
 * touching state.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiPost, fetchJson, getSelfUid, requireOkPayload, resolveUid } from './utils.js';

const SPACE_URL_RE = /space\.bilibili\.com\/(\d+)/i;

async function resolveTargetMid(page, raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        throw new ArgumentError('bilibili unfollow target cannot be empty');
    }
    const urlMatch = trimmed.match(SPACE_URL_RE);
    if (urlMatch) return urlMatch[1];
    try {
        return await resolveUid(page, trimmed);
    } catch (error) {
        if (error instanceof EmptyResultError) throw error;
        throw new ArgumentError(
            `Cannot resolve Bilibili target from input: ${trimmed}`,
            error instanceof Error ? error.message : String(error),
        );
    }
}

async function fetchRelationAttribute(page, mid) {
    const payload = await fetchJson(page, `https://api.bilibili.com/x/relation?fid=${mid}`);
    requireOkPayload(payload, 'relation query');
    const attribute = payload?.data?.attribute;
    return typeof attribute === 'number' ? attribute : 0;
}

cli({
    site: 'bilibili',
    name: 'unfollow',
    access: 'write',
    description: '取消关注 B站用户（官方 API，需登录）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        {
            name: 'target',
            required: true,
            positional: true,
            help: '目标 UID / 用户名 / space.bilibili.com 链接',
        },
    ],
    columns: ['mid', 'name', 'status', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for bilibili unfollow');
        }
        const mid = await resolveTargetMid(page, kwargs.target);
        const self = await getSelfUid(page);
        if (mid === self) {
            throw new ArgumentError('Cannot unfollow yourself');
        }
        const attribute = await fetchRelationAttribute(page, mid);
        const url = `https://space.bilibili.com/${mid}`;
        // attribute 2=following, 6=mutual. Anything else means the viewer isn't
        // currently following — skip the POST and return idempotent status.
        if (attribute !== 2 && attribute !== 6) {
            return [{ mid, name: '', status: 'not-following', url }];
        }
        const payload = await apiPost(page, '/x/relation/modify', {
            params: { fid: mid, act: 2, re_src: 11 },
        });
        requireOkPayload(payload, 'relation modify');
        return [{ mid, name: '', status: 'unfollowed', url }];
    },
});

export const __test__ = {
    resolveTargetMid,
    fetchRelationAttribute,
};
