/**
 * Bilibili comment — posts a top-level comment or a reply on a video via the official API.
 * Uses /x/v2/reply/add, authenticated by the logged-in cookie + bili_jct CSRF token.
 * @username mentions in the message are resolved to real mentions (at_name_to_mid).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiGet, apiPost, requireOkPayload, resolveBvid, resolveUid } from './utils.js';

function readPositiveInteger(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`bilibili comment ${label} must be a positive integer`);
    }
    return n;
}

cli({
    site: 'bilibili',
    name: 'comment',
    access: 'write',
    description: '在 B站视频下发表评论或回复（官方 API，需登录；消息里的 @用户 会被解析为真实提及）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Video BV ID / URL / b23.tv short link' },
        { name: 'message', required: true, positional: true, help: 'Comment text. Any @username in it is resolved to a real mention' },
        { name: 'parent', type: 'int', help: 'top-level/root rpid to reply under (omit for a top-level comment)' },
        { name: 'execute', type: 'boolean', help: 'Actually post the comment. Without it the command refuses to write.' },
    ],
    columns: ['rpid', 'bvid', 'oid', 'message', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for bilibili comment');
        }
        const message = String(kwargs.message ?? '').trim();
        if (!message)
            throw new ArgumentError('bilibili comment message cannot be empty');
        // Write guard: posting is public and irreversible-ish, so require an explicit opt-in.
        if (!kwargs.execute)
            throw new ArgumentError('Refusing to post: pass --execute to actually publish this comment');
        const parent = kwargs.parent != null ? readPositiveInteger(kwargs.parent, 'parent') : null;
        let bvid;
        try {
            bvid = await resolveBvid(kwargs.bvid);
        }
        catch (error) {
            throw new ArgumentError(`Cannot resolve Bilibili BV ID from input: ${String(kwargs.bvid ?? '')}`, error instanceof Error ? error.message : String(error));
        }
        // Resolve bvid → aid (the reply API addresses videos by aid, as `oid`)
        const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        const viewData = requireOkPayload(view, 'view');
        const oid = viewData?.aid;
        if (!oid)
            throw new CommandExecutionError(`Cannot resolve aid for bvid: ${bvid}`);
        // Resolve @username mentions to uids. Bilibili only turns "@name" into a real
        // mention — one that notifies the mentioned user — when the request carries
        // at_name_to_mid; a plain-text "@name" is otherwise inert and notifies nobody.
        /** @type {Record<string, number>} */
        const atNameToMid = {};
        for (const match of message.matchAll(/@([^\s@]+)/g)) {
            const name = match[1];
            if (name in atNameToMid)
                continue;
            try {
                const mid = Number(await resolveUid(page, name));
                if (!Number.isInteger(mid) || mid <= 0) {
                    throw new CommandExecutionError(`Bilibili user search returned malformed mid for @${name}`);
                }
                atNameToMid[name] = mid;
            }
            catch (error) {
                if (!(error instanceof EmptyResultError)) {
                    throw error;
                }
                // Unresolvable @name (typo, or not a user) — leave it as plain text.
            }
        }
        // For a reply, Bilibili needs both `root` (top-level comment) and `parent`.
        // Replying to a top-level comment means root === parent.
        const params = {
            oid,
            type: 1,
            message,
            plat: 1,
            ...(parent != null
                ? { root: parent, parent }
                : {}),
            ...(Object.keys(atNameToMid).length > 0
                ? { at_name_to_mid: JSON.stringify(atNameToMid) }
                : {}),
        };
        const payload = await apiPost(page, '/x/v2/reply/add', { params });
        const postData = requireOkPayload(payload, 'reply add');
        const rpid = postData?.rpid;
        if (!rpid) {
            throw new CommandExecutionError('Bilibili reply add API did not return rpid for the posted comment');
        }
        return [{
            rpid: String(rpid),
            bvid,
            oid: String(oid),
            message,
            url: `https://www.bilibili.com/video/${bvid}#reply${rpid}`,
        }];
    },
});
