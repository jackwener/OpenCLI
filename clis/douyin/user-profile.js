import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { PROFILE_COLUMNS, assertProfileLocation, publicCount, trustedProfileId } from '../_shared/social-profile.js';
import { positiveInteger, requireObject } from '../_shared/private-messages.js';
import { fetchDouyinUserVideos } from './_shared/public-api.js';

export function parsePublicSecUid(value) {
    return trustedProfileId(value, 'www.douyin.com', '/user/', /^MS4wLjABAAAA[A-Za-z0-9_-]{8,}$/);
}

export const PROFILE_SNAPSHOT_JS = `(() => {
    const anchors = document.querySelectorAll('[data-e2e="user-info-follow-btn"], [data-e2e="user-detail"]');
    for (const anchor of anchors) {
        let fiber = anchor[Object.keys(anchor).find(k => k.startsWith('__reactFiber'))];
        for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
            const info = fiber.memoizedProps?.userInfo;
            if (info?.uid && info?.secUid) return {
                observedUrl: location.href,
                info: { uid: info.uid, secUid: info.secUid, nickname: info.nickname, desc: info.desc,
                    avatarUrl: info.avatarUrl, followerCount: info.followerCount, followingCount: info.followingCount,
                    totalFavorited: info.totalFavorited, awemeCount: info.awemeCount, ipLocation: info.ipLocation },
                followLabel: [...document.querySelectorAll('[data-e2e="user-info-follow-btn"]')]
                    .find(e => e.getBoundingClientRect().width > 0)?.textContent.trim() ?? null,
            };
        }
    }
    const modal = document.querySelector('[class*="login-mask"],[class*="LoginMask"],[class*="login-modal"]');
    return { observedUrl: location.href, auth: !!modal && modal.getBoundingClientRect().width > 0 };
})()`;

export function projectUserProfile(snapshot, secUid, posts = []) {
    const url = `https://www.douyin.com/user/${secUid}`;
    if (snapshot.auth) throw new AuthRequiredError('www.douyin.com');
    assertProfileLocation(snapshot.observedUrl, url);
    const info = snapshot.info;
    if (!info || info.secUid !== secUid || typeof info.uid !== 'string' || !/^\d+$/.test(info.uid) || typeof info.nickname !== 'string') {
        throw new CommandExecutionError('Douyin public profile model identity mismatch or malformed data');
    }
    const statuses = { '关注': 'not-following', '关注TA': 'not-following', '+ 关注': 'not-following', '已关注': 'following', '相互关注': 'mutual', '互相关注': 'mutual' };
    return {
        user_id: info.uid, sec_uid: secUid, nickname: info.nickname, bio: typeof info.desc === 'string' ? info.desc : null,
        avatar_url: info.avatarUrl || null,
        follower_count: publicCount(info.followerCount, 'Douyin followers'),
        following_count: publicCount(info.followingCount, 'Douyin following'),
        liked_count: publicCount(info.totalFavorited, 'Douyin likes'), post_count: publicCount(info.awemeCount, 'Douyin posts'),
        follow_status: statuses[snapshot.followLabel] ?? null, ip_location: typeof info.ipLocation === 'string' ? info.ipLocation : null,
        profile_url: url, posts,
    };
}

export async function readPublicProfile(page, secUid, limit = 5) {
    await page.goto(`https://www.douyin.com/user/${secUid}`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const snapshot = requireObject(await page.evaluate(PROFILE_SNAPSHOT_JS), 'Douyin public profile');
        if (snapshot.auth) throw new AuthRequiredError('www.douyin.com');
        if (snapshot.info) {
            const row = projectUserProfile(snapshot, secUid);
            if (row.post_count === 0) return row;
            const videos = await fetchDouyinUserVideos(page, secUid, limit);
            if (!Array.isArray(videos)) throw new CommandExecutionError('Douyin public profile post list was malformed');
            row.posts = videos.slice(0, limit).map(video => {
                if (typeof video.aweme_id !== 'string' || !/^\d+$/.test(video.aweme_id) || video.author?.sec_uid !== secUid) {
                    throw new CommandExecutionError('Douyin public profile returned posts belonging to a different author');
                }
                return { id: video.aweme_id, title: video.desc ?? '', url: `https://www.douyin.com/video/${video.aweme_id}` };
            });
            return row;
        }
        await page.wait(0.5);
    }
    throw new TimeoutError('Douyin public profile hydration', 15);
}

export const command = cli({
    site: 'douyin', name: 'user-profile', access: 'read', description: '读取指定普通用户主页、数字 UID 与近期公开作品（非本人创作者账号）',
    domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [
        { name: 'target', positional: true, required: true, help: 'sec_uid or exact public profile URL (not numeric UID)' },
        { name: 'limit', type: 'int', default: 5, help: 'Maximum recent public posts (1-20)' },
    ], columns: PROFILE_COLUMNS,
    validateArgs: args => { parsePublicSecUid(args.target); positiveInteger(args.limit, 5, 20, '--limit'); },
    func: async (page, args) => [await readPublicProfile(page, parsePublicSecUid(args.target), positiveInteger(args.limit, 5, 20, '--limit'))],
});
