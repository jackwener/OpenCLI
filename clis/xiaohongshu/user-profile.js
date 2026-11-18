import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { PROFILE_COLUMNS, assertProfileLocation, publicCount } from '../_shared/social-profile.js';
import { positiveInteger, requireObject } from '../_shared/private-messages.js';
import { parsePrivateUserId } from './im.js';
import { USER_SNAPSHOT_JS } from './user.js';
import { extractXhsUserNotes } from './user-helpers.js';

export function projectUserProfile(snapshot, target, limit) {
    if (snapshot.loginWall) throw new AuthRequiredError('www.xiaohongshu.com');
    const url = `https://www.xiaohongshu.com/user/profile/${target}`;
    assertProfileLocation(snapshot.observedUrl, url);
    if (snapshot.modelTarget !== target) throw new CommandExecutionError('Xiaohongshu public profile model identity mismatch');
    const data = snapshot.pageData;
    if (!data?.basicInfo || typeof data.basicInfo.nickname !== 'string' || !Array.isArray(snapshot.noteGroups)) {
        throw new CommandExecutionError('Xiaohongshu public profile data was malformed');
    }
    const info = data.basicInfo;
    const stats = Object.fromEntries(Object.values(data.interactions ?? {}).map(item => [item.type, publicCount(item.count, 'Xiaohongshu public profile')]));
    const statuses = { '关注': 'not-following', '+关注': 'not-following', '+ 关注': 'not-following', '已关注': 'following', '已互关': 'mutual', '互相关注': 'mutual' };
    return {
        user_id: target, sec_uid: null, nickname: info.nickname, bio: typeof info.desc === 'string' ? info.desc : null,
        avatar_url: info.imageb || info.images || null,
        follower_count: stats.fans ?? null, following_count: stats.follows ?? null, liked_count: stats.interaction ?? null,
        post_count: null, // The observed web snapshot does not provide a verified total-post count.
        follow_status: statuses[snapshot.followLabel] ?? null,
        ip_location: typeof info.ipLocation === 'string' ? info.ipLocation : null,
        profile_url: url,
        posts: extractXhsUserNotes(snapshot, target).slice(0, limit),
    };
}

export const PROFILE_SNAPSHOT_JS = `(() => {
    const snapshot = ${USER_SNAPSHOT_JS};
    const store = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('user');
    const header = document.querySelector('.user-info, .profile-info, .user-detail');
    const button = [...(header || document).querySelectorAll('button,[role=button]')].find(e =>
        e.getBoundingClientRect().width > 0 && /^(关注|\\+ ?关注|已关注|已互关|互相关注)$/.test(e.textContent.trim()));
    return { ...snapshot, observedUrl: location.href, modelTarget: store?.visitTargetUserId, followLabel: button?.textContent.trim() ?? null };
})()`;

export async function readPublicProfile(page, target, limit = 5) {
    await page.goto(`https://www.xiaohongshu.com/user/profile/${target}`);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const snapshot = requireObject(await page.evaluate(PROFILE_SNAPSHOT_JS), 'Xiaohongshu profile');
        if (snapshot.loginWall) throw new AuthRequiredError('www.xiaohongshu.com');
        if (snapshot.pageData?.basicInfo?.nickname != null) return projectUserProfile(snapshot, target, limit);
        await page.wait(0.5);
    }
    throw new TimeoutError('Xiaohongshu public profile hydration', 6);
}

export const command = cli({
    site: 'xiaohongshu', name: 'user-profile', access: 'read', description: '读取普通用户主页档案及首屏公开笔记（非创作者后台）',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [
        { name: 'target', positional: true, required: true, help: 'User ID or exact public profile URL' },
        { name: 'limit', type: 'int', default: 5, help: 'Maximum posts from the loaded profile snapshot (1-20); not all history' },
    ],
    columns: PROFILE_COLUMNS,
    validateArgs: args => { parsePrivateUserId(args.target); positiveInteger(args.limit, 5, 20, '--limit'); },
    func: async (page, args) => [await readPublicProfile(page, parsePrivateUserId(args.target), positiveInteger(args.limit, 5, 20, '--limit'))],
});
