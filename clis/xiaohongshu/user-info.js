/**
 * Xiaohongshu user-info — profile card metadata for one user.
 *
 * The profile page (/user/profile/<id>) server-renders the user store, so the
 * data is read straight from `__INITIAL_STATE__.user.userPageData` (the same
 * store `xiaohongshu user` reads notes from). No signed API call is needed.
 *
 *   basicInfo     → nickname, redId, desc, images/imageb (avatar), ipLocation
 *   interactions  → [{type:'follows'}, {type:'fans'}, {type:'interaction'}]
 *   extraInfo     → fstatus: 'none' | 'follows' | 'fans' | 'both'
 *
 * notes_count is not exposed by the web profile page and is emitted as null.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeXhsAvatar, parseXhsCount, PINIA_ACCESS_JS, requireXhsUserId, xhsProfileUrl } from './pinia-helpers.js';
import { unwrapEvaluateResult } from './shared.js';

const HYDRATION_RETRIES = 8;
const HYDRATION_WAIT_SECONDS = 1.5;

/**
 * Snapshot the profile store. Reads both the Pinia store (preferred; always
 * the live reactive object) and the SSR `__INITIAL_STATE__` fallback.
 */
export const USER_INFO_SNAPSHOT_JS = `
  (() => {
    ${PINIA_ACCESS_JS}
    const store = __xhsStore('user');
    const state = (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user) || null;
    const pick = (obj, key) => {
      if (!obj) return undefined;
      const value = obj[key];
      return value && typeof value === 'object' && '_value' in value ? value._value : value;
    };
    const pageData = __xhsClone(store ? store.userPageData : pick(state, 'userPageData')) || null;
    const fetching = __xhsClone(store ? store.userFetchingStatus : pick(state, 'userFetchingStatus'));
    const pathName = (typeof location !== 'undefined' && location.pathname) || '';
    return {
      storePresent: Boolean(store || state),
      pageData,
      fetchingStatus: typeof fetching === 'string' ? fetching : null,
      loginWall: __xhsLoggedOut() || pathName.indexOf('/login') === 0,
      pathName,
    };
  })()
`;

function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function hasUserPageData(snapshot) {
    return isPlainObject(snapshot?.pageData) && isPlainObject(snapshot.pageData.basicInfo)
        && Object.keys(snapshot.pageData.basicInfo).length > 0;
}

function interactionCount(pageData, type) {
    const list = Array.isArray(pageData?.interactions) ? pageData.interactions : [];
    const hit = list.find((item) => item && item.type === type);
    return hit ? parseXhsCount(hit.count ?? hit.i18nCount) : null;
}

/**
 * Map a profile snapshot into the documented row. Every documented key is
 * present; unavailable values are `null`.
 */
export function mapXhsUserInfo(pageData, userId, webHost = 'www.xiaohongshu.com') {
    if (!isPlainObject(pageData) || !isPlainObject(pageData.basicInfo)) {
        throw new CommandExecutionError('Malformed Xiaohongshu user snapshot: basicInfo was not found');
    }
    const basic = pageData.basicInfo;
    const fstatus = typeof pageData.extraInfo?.fstatus === 'string' ? pageData.extraInfo.fstatus : null;
    const desc = typeof basic.desc === 'string' ? basic.desc.trim() : '';
    return {
        user_id: userId,
        nickname: typeof basic.nickname === 'string' ? basic.nickname : '',
        red_id: typeof basic.redId === 'string' && basic.redId ? basic.redId : (typeof basic.red_id === 'string' && basic.red_id ? basic.red_id : null),
        desc: desc || null,
        fans: interactionCount(pageData, 'fans'),
        follows: interactionCount(pageData, 'follows'),
        likes_collects: interactionCount(pageData, 'interaction'),
        notes_count: null,
        following: fstatus === null ? null : (fstatus === 'follows' || fstatus === 'both'),
        follow_status: fstatus,
        ip_location: typeof basic.ipLocation === 'string' && basic.ipLocation ? basic.ipLocation : null,
        avatar: normalizeXhsAvatar(basic.imageb || basic.images || basic.image),
        url: xhsProfileUrl(userId, webHost),
    };
}

export async function readXhsUserInfoSnapshot(page, maxRetries = HYDRATION_RETRIES, waitSeconds = HYDRATION_WAIT_SECONDS) {
    let snapshot = unwrapEvaluateResult(await page.evaluate(USER_INFO_SNAPSHOT_JS));
    for (let i = 0; i < maxRetries; i += 1) {
        if (!isPlainObject(snapshot)) {
            break;
        }
        if (snapshot.loginWall === true || hasUserPageData(snapshot) || snapshot.fetchingStatus === 'rejected') {
            break;
        }
        await page.wait({ time: waitSeconds });
        snapshot = unwrapEvaluateResult(await page.evaluate(USER_INFO_SNAPSHOT_JS));
    }
    if (!isPlainObject(snapshot)) {
        throw new CommandExecutionError('Malformed Xiaohongshu user snapshot');
    }
    return snapshot;
}

export async function fetchXhsUserInfo(page, userId, webHost = 'www.xiaohongshu.com') {
    await page.goto(xhsProfileUrl(userId, webHost));
    const snapshot = await readXhsUserInfoSnapshot(page);
    if (snapshot.loginWall === true) {
        throw new AuthRequiredError(webHost, 'Xiaohongshu profile requires login (page redirected to /login or session expired); re-login and retry.');
    }
    if (!hasUserPageData(snapshot)) {
        if (snapshot.fetchingStatus === 'rejected' || snapshot.pageData?.result?.code) {
            throw new EmptyResultError('xiaohongshu user-info', `User ${userId} was not found or is unavailable (${snapshot.pageData?.result?.message ?? 'profile request rejected'}).`);
        }
        if (snapshot.storePresent !== true) {
            throw new CommandExecutionError('Malformed Xiaohongshu user snapshot: user store was not found');
        }
        throw new EmptyResultError('xiaohongshu user-info', `No profile data was rendered for user ${userId} (account may be deleted or private).`);
    }
    return mapXhsUserInfo(snapshot.pageData, userId, webHost);
}

export const XHS_USER_INFO_COLUMNS = ['user_id', 'nickname', 'red_id', 'desc', 'fans', 'follows', 'likes_collects', 'notes_count', 'following', 'follow_status', 'ip_location', 'avatar', 'url'];

cli({
    site: 'xiaohongshu',
    name: 'user-info',
    access: 'read',
    description: '小红书用户信息（昵称 / 小红书号 / 简介 / 粉丝 / 关注 / 获赞与收藏 / 头像）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'user-id', type: 'string', required: true, positional: true, help: 'User ID (e.g. 5d8f88dc0000000001005d3a) or profile URL' },
    ],
    columns: XHS_USER_INFO_COLUMNS,
    func: async (page, kwargs) => {
        const userId = requireXhsUserId(kwargs['user-id'], 'xiaohongshu/user-info');
        return [await fetchXhsUserInfo(page, userId)];
    },
});

export const __test__ = { HYDRATION_RETRIES, HYDRATION_WAIT_SECONDS };
