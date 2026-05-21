/**
 * Bilibili comments — fetches comments via the official API.
 * Top-level comments come from /x/v2/reply/main (WBI-signed); with --parent,
 * the replies nested under a given comment come from /x/v2/reply/reply.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid } from './utils.js';

const MAX_LIMIT = 50;

function isAuthLikeBilibiliError(code, message) {
    return code === -101 || code === -403 || /登录|账号|权限|forbidden|permission|login/i.test(String(message ?? ''));
}

function parseLimit(value) {
    const raw = value == null ? 20 : value;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new ArgumentError(`bilibili comments limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

function parseParent(value) {
    if (value == null) {
        return null;
    }
    const parent = Number(value);
    if (!Number.isInteger(parent) || parent <= 0) {
        throw new ArgumentError('bilibili comments parent must be a positive integer rpid');
    }
    return parent;
}

function requireOkPayload(payload, label) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'code')) {
        throw new CommandExecutionError(`Bilibili ${label} API returned a malformed payload`);
    }
    if (payload.code !== 0) {
        const message = payload.message ?? 'unknown error';
        if (isAuthLikeBilibiliError(payload.code, message)) {
            throw new AuthRequiredError('bilibili.com', `Bilibili ${label} API requires login or permission: ${message} (${payload.code})`);
        }
        throw new CommandExecutionError(`Bilibili ${label} API failed: ${message} (${payload.code})`);
    }
    return payload.data;
}

function requireReplies(data, label) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new CommandExecutionError(`Bilibili ${label} API returned malformed data`);
    }
    if (!Object.hasOwn(data, 'replies')) {
        throw new CommandExecutionError(`Bilibili ${label} API did not return replies`);
    }
    if (data.replies === null) {
        return [];
    }
    if (!Array.isArray(data.replies)) {
        throw new CommandExecutionError(`Bilibili ${label} API returned malformed replies`);
    }
    return data.replies;
}

function formatReplyRow(reply, index) {
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
        throw new CommandExecutionError(`Bilibili comments reply ${index + 1} was malformed`);
    }
    const rpid = String(reply.rpid ?? '').trim();
    if (!rpid) {
        throw new CommandExecutionError(`Bilibili comments reply ${index + 1} was missing rpid`);
    }
    const ctime = Number(reply.ctime);
    if (!Number.isFinite(ctime)) {
        throw new CommandExecutionError(`Bilibili comments reply ${index + 1} was missing ctime`);
    }
    return {
        rank: index + 1,
        rpid,
        author: String(reply.member?.uname ?? ''),
        text: String(reply.content?.message ?? '').replace(/\n/g, ' ').trim(),
        likes: reply.like ?? 0,
        replies: reply.rcount ?? 0,
        time: new Date(ctime * 1000).toISOString().slice(0, 16).replace('T', ' '),
    };
}

cli({
    site: 'bilibili',
    name: 'comments',
    access: 'read',
    description: '获取 B站视频评论（官方 API；用 --parent <rpid> 读取某条评论下的「楼中楼」回复）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Video BV ID (e.g. BV1WtAGzYEBm)' },
        { name: 'parent', type: 'int', help: 'rpid of a comment — fetch the replies under it instead of top-level comments' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
    ],
    columns: ['rank', 'rpid', 'author', 'text', 'likes', 'replies', 'time'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for bilibili comments');
        }
        let bvid;
        try {
            bvid = await resolveBvid(kwargs.bvid);
        }
        catch (error) {
            throw new ArgumentError(`Cannot resolve Bilibili BV ID from input: ${String(kwargs.bvid ?? '')}`, error instanceof Error ? error.message : String(error));
        }
        const limit = parseLimit(kwargs.limit);
        const parent = parseParent(kwargs.parent);
        // Resolve bvid → aid (required by reply API)
        const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        const viewData = requireOkPayload(view, 'view');
        const aid = viewData?.aid;
        if (!aid)
            throw new CommandExecutionError(`Cannot resolve aid for bvid: ${bvid}`);
        const payload = parent != null
            ? await apiGet(page, '/x/v2/reply/reply', {
                params: { oid: aid, type: 1, root: parent, pn: 1, ps: limit },
            })
            : await apiGet(page, '/x/v2/reply/main', {
                params: { oid: aid, type: 1, mode: 3, ps: limit },
                signed: true,
            });
        const label = parent != null ? 'reply thread' : 'reply main';
        const replies = requireReplies(requireOkPayload(payload, label), label);
        if (replies.length === 0) {
            throw new EmptyResultError(parent != null ? `bilibili comment replies: ${parent}` : `bilibili comments: ${bvid}`);
        }
        return replies.slice(0, limit).map(formatReplyRow);
    },
});
