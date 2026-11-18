import { Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { WRITE_ARGS, WRITE_COLUMNS, parseWriteOptions, runApprovedWrite } from '../../_shared/social-write.js';
import { requireObject } from '../../_shared/private-messages.js';
import { parsePublicSecUid, PROFILE_SNAPSHOT_JS, projectUserProfile } from '../user-profile.js';
import { evaluateIm } from '../im.js';
import { locateImApp } from '../write-im.js';

export function followRuntime(args, snapshot, locate) {
    if (!['probe', 'follow', 'unfollow'].includes(args.operation)) throw Error('Unsupported follow operation');
    const current = snapshot();
    const actor = window.SSR_RENDER_DATA?.app?.user?.info?.uid;
    if (typeof actor !== 'string' || !/^[1-9]\d*$/.test(actor) || current.auth) return { state: 'auth' };
    const info = current.info;
    if (location.origin !== 'https://www.douyin.com' || location.pathname.replace(/\/$/, '') !== `/user/${args.secUid}`
        || info?.secUid !== args.secUid || typeof info.uid !== 'string' || !/^[1-9]\d*$/.test(info.uid) || info.uid === actor) throw Error('Profile identity mismatch');
    const labels = { '关注': 'not-following', '关注TA': 'not-following', '+ 关注': 'not-following', '已关注': 'following', '相互关注': 'following', '互相关注': 'following' };
    const revision = labels[current.followLabel];
    if (!revision) throw Error('Unknown follow state');
    if (args.operation === 'probe') return { state: 'ok', accountId: actor, userId: info.uid, revision };
    if (actor !== args.accountId || info.uid !== args.userId || Date.now() >= args.expiresAt || revision !== args.revision) throw Error('Reviewed follow state changed');
    const liveActor = locate().imSdkService.imSdkManager.getImSdkInstance()?.ctx?.option?.userId;
    if (liveActor !== actor) throw Error('Live account changed');
    const desired = args.operation === 'follow' ? 'following' : 'not-following';
    if (revision === desired) return { state: 'ok', status: desired === 'following' ? 'already-following' : 'already-not-following' };
    const buttons = [...document.querySelectorAll('[data-e2e="user-info-follow-btn"]')].filter(e => e.getBoundingClientRect().width > 0);
    if (buttons.length !== 1) throw Error('Follow control is absent or ambiguous');
    let fiber = buttons[0][Object.keys(buttons[0]).find(key => key.startsWith('__reactFiber'))];
    let target;
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
        if (fiber.memoizedProps?.userInfo) { target = fiber.memoizedProps.userInfo; break; }
    }
    if (target?.uid !== args.userId || target.secUid !== args.secUid) throw Error('Follow control recipient changed');
    buttons[0].click(); // One native action only; do not guess/click confirmation dialogs.
    return { state: 'ok', status: 'clicked' };
}

export function buildFollowScript(args) {
    return `(${followRuntime.toString()})(${JSON.stringify(args)}, () => ${PROFILE_SNAPSHOT_JS}, ${locateImApp.toString()})`;
}

async function inspect(page, args) {
    let data;
    try { data = requireObject(await page.evaluate(buildFollowScript(args)), 'Douyin follow'); }
    catch { throw new CommandExecutionError('Douyin follow identity/state verification failed'); }
    if (data.state === 'auth') throw new AuthRequiredError('www.douyin.com');
    if (data.state !== 'ok') throw new CommandExecutionError('Douyin follow returned an invalid result');
    return data;
}

export async function prepareFollow(page, secUid, action) {
    await page.goto(`https://www.douyin.com/user/${secUid}`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const snapshot = requireObject(await page.evaluate(PROFILE_SNAPSHOT_JS), 'Douyin follow profile');
        if (snapshot.auth) throw new AuthRequiredError('www.douyin.com');
        if (snapshot.info) {
            projectUserProfile(snapshot, secUid);
            const state = await inspect(page, { secUid, operation: 'probe' });
            return { site: 'douyin', action, secUid, ...state, conversationId: null, text: null };
        }
        await page.wait(0.5);
    }
    throw new CommandExecutionError('Douyin follow profile did not hydrate');
}

export function followOptions(action) {
    return {
        access: 'write', description: `${action === 'follow' ? '关注' : '取消关注'}普通用户；默认预检查，执行需独立签名审批`,
        domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
        args: [{ name: 'target', positional: true, required: true, help: 'Public sec_uid or exact www.douyin.com/user profile URL' }, ...WRITE_ARGS],
        columns: WRITE_COLUMNS,
        validateArgs: args => { parsePublicSecUid(args.target); parseWriteOptions(args); },
        func: async (page, args) => {
            const secUid = parsePublicSecUid(args.target); const options = parseWriteOptions(args);
            const plan = await prepareFollow(page, secUid, action);
            return runApprovedWrite({ ...args, 'request-id': options.requestId }, plan, async expiresAt => {
                await evaluateIm(page, 'ready');
                const clicked = await inspect(page, { ...plan, secUid, operation: action, expiresAt });
                if (clicked.status !== 'clicked') return { status: clicked.status };
                // New navigation avoids trusting an optimistic follow-label flip.
                await page.wait(1);
                const after = await prepareFollow(page, secUid, action);
                if (after.accountId !== plan.accountId || after.userId !== plan.userId) throw new CommandExecutionError('Account or recipient changed after follow action');
                const expected = action === 'follow' ? 'following' : 'not-following';
                return { status: after.revision === expected ? (action === 'follow' ? 'followed' : 'unfollowed') : 'unknown' };
            });
        },
    };
}
