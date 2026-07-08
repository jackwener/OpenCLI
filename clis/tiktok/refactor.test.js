// Contract tests for the Phase-3 refactor that retired the legacy DOM-link
// scraping pattern across explore / user / friends / following / notifications / live.
// Each adapter is now func + Strategy.COOKIE + browser:true with shared helpers
// from utils.js — these tests pin down (a) registration metadata, (b) typed-
// error boundary, (c) build-script invariants (no raw user-input concatenation,
// expected endpoint markers, JSON.stringify-embedded inputs).

import { describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { exploreCommand, __test__ as exploreTest } from './explore.js';
import { friendsCommand, __test__ as friendsTest } from './friends.js';
import { followingCommand, __test__ as followingTest } from './following.js';
import { notificationsCommand, __test__ as notificationsTest } from './notifications.js';
import { liveCommand, __test__ as liveTest } from './live.js';
import { userCommand, __test__ as userTest } from './user.js';
import {
    BROWSER_HELPERS,
    NOTIFICATION_TYPES,
    VIDEO_ITEM_NORMALIZER,
    USER_ITEM_NORMALIZER,
    LIVE_ITEM_NORMALIZER,
    NOTIFICATION_NORMALIZER,
    normalizeUsername,
    requireLimit,
    requireNotificationType,
} from './utils.js';

function makePage(rows) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(rows),
    };
}

function makeFailingPage(error) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockRejectedValue(error),
    };
}

const sampleVideoRow = {
    index: 1,
    id: '7350000000000000000',
    author: 'creator',
    url: 'https://www.tiktok.com/@creator/video/7350000000000000000',
    cover: 'https://example.com/cover.jpg',
    title: 'a fun clip',
    desc: 'a fun clip',
    plays: 12345,
    likes: 678,
    comments: 9,
    shares: 1,
    createTime: 1710000000,
};

const sampleUserVideoRow = {
    ...sampleVideoRow,
    source: 'profile-api',
};

const sampleUserRow = {
    index: 1,
    username: 'creator',
    name: 'Creator',
    secUid: 'MS4wLjA',
    verified: false,
    followers: 1000,
    following: 50,
    url: 'https://www.tiktok.com/@creator',
};

const sampleNotificationRow = {
    index: 1,
    id: 'notice-1',
    from: 'someone',
    text: 'liked your video',
    createTime: 1710000000,
};

const sampleLiveRow = {
    index: 1,
    streamer: 'host1',
    name: 'Host One',
    title: 'cooking show',
    viewers: 500,
    likes: 0,
    secUid: 'MS4wLjA',
    url: 'https://www.tiktok.com/@host1/live',
};

describe('tiktok/utils', () => {
    it('requireLimit rejects 0 / negative / non-integer / over-max with ArgumentError', () => {
        expect(() => requireLimit(0, { fallback: 10, max: 50 })).toThrow(ArgumentError);
        expect(() => requireLimit(-1, { fallback: 10, max: 50 })).toThrow(ArgumentError);
        expect(() => requireLimit(1.5, { fallback: 10, max: 50 })).toThrow(ArgumentError);
        expect(() => requireLimit(51, { fallback: 10, max: 50 })).toThrow(ArgumentError);
        expect(requireLimit(undefined, { fallback: 10, max: 50 })).toBe(10);
        expect(requireLimit(20, { fallback: 10, max: 50 })).toBe(20);
    });

    it('normalizeUsername strips @ and validates allowed charset', () => {
        expect(normalizeUsername('@dictogo')).toBe('dictogo');
        expect(normalizeUsername(' creator.name ')).toBe('creator.name');
        expect(() => normalizeUsername('')).toThrow(ArgumentError);
        expect(() => normalizeUsername('bad name')).toThrow(ArgumentError);
        expect(() => normalizeUsername('bad/name')).toThrow(ArgumentError);
    });

    it('requireNotificationType maps known keys and rejects unknown via ArgumentError', () => {
        expect(requireNotificationType('all')).toBe('all');
        expect(requireNotificationType('LIKES')).toBe('likes');
        expect(() => requireNotificationType('bogus')).toThrow(ArgumentError);
    });

    it('BROWSER_HELPERS is a string template that exposes the expected helper names', () => {
        expect(typeof BROWSER_HELPERS).toBe('string');
        for (const name of ['asNumber', 'cleanText', 'getCookie', 'fetchJson', 'assertTikTokApiSuccess', 'findUniversalData', 'walkObjects']) {
            expect(BROWSER_HELPERS).toContain('function ' + name + '(');
        }
        const asNumber = new Function(`${BROWSER_HELPERS}; return asNumber;`)();
        expect(asNumber(null)).toBeNull();
        expect(asNumber('')).toBeNull();
        expect(asNumber(0)).toBe(0);
        const assertTikTokApiSuccess = new Function(`${BROWSER_HELPERS}; return assertTikTokApiSuccess;`)();
        expect(() => assertTikTokApiSuccess({ status_code: 0 }, 'test')).not.toThrow();
        expect(() => assertTikTokApiSuccess({ status_code: 8, status_msg: 'login required' }, 'test')).toThrow(/AUTH_REQUIRED/);
        expect(() => assertTikTokApiSuccess({ status_code: 1001, status_msg: 'rate limited' }, 'test')).toThrow(/test API failed: rate limited/);
    });

    it('Item normalizers produce well-formed JS function declarations', () => {
        expect(VIDEO_ITEM_NORMALIZER).toContain('function normalizeVideoItem(');
        expect(USER_ITEM_NORMALIZER).toContain('function normalizeUserRow(');
        expect(LIVE_ITEM_NORMALIZER).toContain('function normalizeLiveItem(');
        expect(LIVE_ITEM_NORMALIZER).toContain('room.user_count ?? room.viewerCount');
        expect(LIVE_ITEM_NORMALIZER).toContain('room.like_count ?? room.likeCount');
        expect(NOTIFICATION_NORMALIZER).toContain('function normalizeNotification(');
    });
});

describe('tiktok/explore (page-context refactor)', () => {
    it('registers as read-only browser COOKIE adapter with full video columns', () => {
        expect(exploreCommand.access).toBe('read');
        expect(exploreCommand.browser).toBe(true);
        expect(exploreCommand.strategy).toBe('cookie');
        expect(exploreCommand.columns).toEqual([
            'index', 'id', 'author', 'url', 'cover', 'title', 'desc',
            'plays', 'likes', 'comments', 'shares', 'createTime',
        ]);
    });

    it('validates --limit upfront before navigating (no silent clamp)', async () => {
        const page = makePage([]);
        await expect(exploreCommand.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(exploreCommand.func(page, { limit: exploreTest.MAX_LIMIT + 1 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to /explore and returns the full video row shape from evaluate', async () => {
        const page = makePage([sampleVideoRow, { ...sampleVideoRow, id: '7350000000000000001', index: 99 }]);
        const rows = await exploreCommand.func(page, { limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/explore', { waitUntil: 'load', settleMs: 5000 });
        expect(rows).toEqual([sampleVideoRow, { ...sampleVideoRow, id: '7350000000000000001', index: 99 }]);
    });

    it('maps empty / unrecognised evaluate failures to typed errors', async () => {
        await expect(exploreCommand.func(makePage([]), { limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(exploreCommand.func(makeFailingPage(new Error('No videos found on /explore')), { limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(exploreCommand.func(makeFailingPage(new Error('No videos found on /explore (recommend API failed: HTTP 500)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(exploreCommand.func(makeFailingPage(new Error('No videos found on /explore (recommend API failed: HTTP 403)')), { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(exploreCommand.func(makeFailingPage(new Error('No videos found on /explore (recommend API failed: invalid JSON)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(exploreCommand.func(makeFailingPage(new Error('boom')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('build script targets recommend-feed state + recommend item_list endpoint', () => {
        const script = exploreTest.buildExploreScript(15);
        expect(script).toContain('/api/recommend/item_list/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'recommend')");
        expect(script).toContain('findUniversalData');
        expect(script).toContain('normalizeVideoItem');
    });
});

describe('tiktok/user (page-context refactor)', () => {
    it('registers as read-only browser COOKIE adapter with sourced video columns', () => {
        expect(userCommand.access).toBe('read');
        expect(userCommand.browser).toBe(true);
        expect(userCommand.strategy).toBe('cookie');
        expect(userCommand.columns).toEqual([
            'index', 'id', 'source', 'author', 'url', 'cover', 'title', 'desc',
            'plays', 'likes', 'comments', 'shares', 'createTime',
        ]);
    });

    it('validates username and --limit upfront before navigating', async () => {
        const page = makePage([]);
        await expect(userCommand.func(page, { username: '', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(userCommand.func(page, { username: '@bad/name', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(userCommand.func(page, { username: 'dictogo', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(userCommand.func(page, { username: 'dictogo', limit: userTest.MAX_LIMIT + 1 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to the profile and returns full sourced video rows', async () => {
        const page = makePage([sampleUserVideoRow]);
        await expect(userCommand.func(page, { username: '@dictogo', limit: 5 })).resolves.toEqual([sampleUserVideoRow]);
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/@dictogo', { waitUntil: 'load', settleMs: 6000 });
    });

    it('maps empty, auth, upstream, and invalid JSON failures to typed errors', async () => {
        await expect(userCommand.func(makePage([]), { username: 'dictogo', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(userCommand.func(makeFailingPage(new Error('No videos found for @dictogo')), { username: 'dictogo', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(userCommand.func(makeFailingPage(new Error('No videos found for @dictogo (profile/search API failed: HTTP 500)')), { username: 'dictogo', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(userCommand.func(makeFailingPage(new Error('No videos found for @dictogo (profile/search API failed: HTTP 403)')), { username: 'dictogo', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(userCommand.func(makeFailingPage(new Error('No videos found for @dictogo (profile/search API failed: invalid JSON)')), { username: 'dictogo', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('build script resolves secUid, pages post-list, and exact-author search fallback', () => {
        const script = userTest.buildUserScript('dictogo', 20);
        expect(script).toContain('/api/user/detail/');
        expect(script).toContain("assertTikTokApiSuccess(detail, 'user-detail')");
        expect(script).toContain('/api/post/item_list/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'post-list')");
        expect(script).toContain('/api/search/general/full/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'search')");
        expect(script).toContain("'profile-api'");
        expect(script).toContain("'bootstrap'");
        expect(script).toContain("'search-fallback'");
        expect(script).toContain(JSON.stringify('dictogo'));
        expect(script).not.toContain('AUTH_REQUIRED: cannot resolve secUid');
    });
});

describe('tiktok/friends (page-context refactor)', () => {
    it('registers as read-only COOKIE adapter with user columns', () => {
        expect(friendsCommand.access).toBe('read');
        expect(friendsCommand.browser).toBe(true);
        expect(friendsCommand.strategy).toBe('cookie');
        expect(friendsCommand.columns).toEqual([
            'index', 'username', 'name', 'secUid', 'verified', 'followers', 'following', 'url',
        ]);
    });

    it('validates --limit upfront and never navigates on bad input', async () => {
        const page = makePage([]);
        await expect(friendsCommand.func(page, { limit: -2 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to /friends and surfaces empty as EmptyResultError', async () => {
        const page = makePage([sampleUserRow]);
        await expect(friendsCommand.func(page, { limit: 5 })).resolves.toEqual([sampleUserRow]);
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/friends', { waitUntil: 'load', settleMs: 5000 });
        await expect(friendsCommand.func(makePage([]), { limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(friendsCommand.func(makeFailingPage(new Error('No friend suggestions returned by TikTok (recommend-user API failed: HTTP 500)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(friendsCommand.func(makeFailingPage(new Error('No friend suggestions returned by TikTok (recommend-user API failed: HTTP 401)')), { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(friendsCommand.func(makeFailingPage(new Error('No friend suggestions returned by TikTok (recommend-user API failed: invalid JSON)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('build script targets recommend-user endpoint via state-then-API', () => {
        const script = friendsTest.buildFriendsScript(20);
        expect(script).toContain('/api/recommend/user/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'recommend-user')");
        expect(script).toContain('findUniversalData');
        expect(script).toContain('normalizeUserRow');
    });
});

describe('tiktok/following (page-context refactor)', () => {
    it('registers as read-only COOKIE adapter with user columns', () => {
        expect(followingCommand.access).toBe('read');
        expect(followingCommand.browser).toBe(true);
        expect(followingCommand.strategy).toBe('cookie');
        expect(followingCommand.columns).toEqual([
            'index', 'username', 'name', 'secUid', 'verified', 'followers', 'following', 'url',
        ]);
    });

    it('validates --limit upfront', async () => {
        const page = makePage([]);
        await expect(followingCommand.func(page, { limit: 999 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps AUTH_REQUIRED sentinel to AuthRequiredError', async () => {
        const page = makeFailingPage(new Error('AUTH_REQUIRED: cannot resolve viewer secUid (login required)'));
        await expect(followingCommand.func(page, { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(followingCommand.func(makeFailingPage(new Error('No following entries returned (user-list API failed: HTTP 500)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(followingCommand.func(makeFailingPage(new Error('No following entries returned (user-list API failed: HTTP 403)')), { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(followingCommand.func(makeFailingPage(new Error('No following entries returned (user-list API failed: invalid JSON)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('navigates to /following and returns the full user row shape', async () => {
        const page = makePage([sampleUserRow]);
        await expect(followingCommand.func(page, { limit: 5 })).resolves.toEqual([sampleUserRow]);
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/following', { waitUntil: 'load', settleMs: 5000 });
    });

    it('build script resolves viewer secUid then pages user-list scene=21', () => {
        const script = followingTest.buildFollowingScript(20);
        expect(script).toContain('/api/user/list/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'user-list')");
        expect(script).toContain("scene: '21'");
        expect(script).toContain('findViewerSecUid');
        expect(script).toContain('normalizeUserRow');
    });
});

describe('tiktok/notifications (page-context refactor)', () => {
    it('registers as read-only COOKIE adapter with notification columns', () => {
        expect(notificationsCommand.access).toBe('read');
        expect(notificationsCommand.browser).toBe(true);
        expect(notificationsCommand.strategy).toBe('cookie');
        expect(notificationsCommand.columns).toEqual([
            'index', 'id', 'from', 'text', 'createTime',
        ]);
    });

    it('validates --limit and --type upfront before navigating', async () => {
        const page = makePage([]);
        await expect(notificationsCommand.func(page, { limit: 0, type: 'all' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(notificationsCommand.func(page, { limit: 5, type: 'bogus' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps AUTH_REQUIRED sentinel to AuthRequiredError, empty to EmptyResultError', async () => {
        await expect(notificationsCommand.func(
            makeFailingPage(new Error('AUTH_REQUIRED: TikTok inbox requires login (likes)')),
            { limit: 5, type: 'likes' },
        )).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(notificationsCommand.func(makePage([]), { limit: 5, type: 'all' })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(notificationsCommand.func(makeFailingPage(new Error('No notifications returned for all (notice API failed: HTTP 500)')), { limit: 5, type: 'all' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(notificationsCommand.func(makeFailingPage(new Error('No notifications returned for all (notice API failed: HTTP 401)')), { limit: 5, type: 'all' })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(notificationsCommand.func(makeFailingPage(new Error('No notifications returned for all (notice API failed: invalid JSON)')), { limit: 5, type: 'all' })).rejects.toBeInstanceOf(CommandExecutionError);
        const page = makePage([sampleNotificationRow]);
        await expect(notificationsCommand.func(page, { limit: 5, type: 'comments' })).resolves.toEqual([sampleNotificationRow]);
    });

    it('embeds the requested notice_type code from NOTIFICATION_TYPES into the script', () => {
        for (const [key, meta] of Object.entries(NOTIFICATION_TYPES)) {
            const script = notificationsTest.buildNotificationsScript(15, key);
            expect(script).toContain('const noticeType = ' + meta.code);
            expect(script).toContain('/api/notice/multi/');
            expect(script).toContain("assertTikTokApiSuccess(data, 'notice')");
        }
    });
});

describe('tiktok/live (page-context refactor)', () => {
    it('registers as read-only COOKIE adapter with live columns', () => {
        expect(liveCommand.access).toBe('read');
        expect(liveCommand.browser).toBe(true);
        expect(liveCommand.strategy).toBe('cookie');
        expect(liveCommand.columns).toEqual([
            'index', 'streamer', 'name', 'title', 'viewers', 'likes', 'secUid', 'url',
        ]);
    });

    it('validates --limit upfront', async () => {
        const page = makePage([]);
        await expect(liveCommand.func(page, { limit: -1 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to /live and surfaces empty as EmptyResultError', async () => {
        const page = makePage([sampleLiveRow]);
        await expect(liveCommand.func(page, { limit: 5 })).resolves.toEqual([sampleLiveRow]);
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/live', { waitUntil: 'load', settleMs: 5000 });
        await expect(liveCommand.func(makePage([]), { limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(liveCommand.func(makeFailingPage(new Error('No live streams returned (live-discover API failed: HTTP 500)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(liveCommand.func(makeFailingPage(new Error('No live streams returned (live-discover API failed: HTTP 403)')), { limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(liveCommand.func(makeFailingPage(new Error('No live streams returned (live-discover API failed: invalid JSON)')), { limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('build script targets live-discover endpoint via state-then-API', () => {
        const script = liveTest.buildLiveScript(15);
        expect(script).toContain('/api/live/discover/get/');
        expect(script).toContain("assertTikTokApiSuccess(data, 'live-discover')");
        expect(script).toContain('findUniversalData');
        expect(script).toContain('normalizeLiveItem');
    });
});
