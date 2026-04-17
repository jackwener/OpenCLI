import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchDouyinComments, fetchDouyinUserVideos } from './_shared/public-api.js';
export const MAX_USER_VIDEOS_LIMIT = 20;
export const USER_VIDEO_COMMENT_CONCURRENCY = 4;
export const DEFAULT_COMMENT_LIMIT = 10;
export function normalizeUserVideosLimit(limit) {
    const numeric = Number(limit);
    if (!Number.isFinite(numeric))
        return MAX_USER_VIDEOS_LIMIT;
    return Math.min(MAX_USER_VIDEOS_LIMIT, Math.max(1, Math.round(numeric)));
}
export function normalizeCommentLimit(limit) {
    const numeric = Number(limit);
    if (!Number.isFinite(numeric))
        return DEFAULT_COMMENT_LIMIT;
    return Math.min(DEFAULT_COMMENT_LIMIT, Math.max(1, Math.round(numeric)));
}
async function mapInBatches(items, concurrency, mapper) {
    const results = [];
    for (let index = 0; index < items.length; index += concurrency) {
        const chunk = items.slice(index, index + concurrency);
        results.push(...(await Promise.all(chunk.map(mapper))));
    }
    return results;
}
async function fetchTopComments(page, awemeId, count) {
    try {
        return await fetchDouyinComments(page, awemeId, count);
    }
    catch {
        return [];
    }
}
cli({
    site: 'douyin',
    name: 'user-videos',
    description: '获取指定用户的视频列表（含下载地址和热门评论）',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'sec_uid', type: 'string', required: true, positional: true, help: '用户 sec_uid（URL 末尾部分）' },
        { name: 'limit', type: 'int', default: 20, help: '获取数量（最大 20）' },
        { name: 'with_comments', type: 'bool', default: true, help: '包含热门评论（默认: true）' },
        { name: 'comment_limit', type: 'int', default: 10, help: '每个视频获取多少条评论（最大 10）' },
    ],
    columns: ['index', 'aweme_id', 'title', 'duration', 'digg_count', 'play_url', 'top_comments'],
    func: async (page, kwargs) => {
        const secUid = kwargs.sec_uid;
        const limit = normalizeUserVideosLimit(kwargs.limit);
        const withComments = kwargs.with_comments !== false;
        const commentLimit = normalizeCommentLimit(kwargs.comment_limit);
        await page.goto(`https://www.douyin.com/user/${secUid}`);
        await page.wait(3);
        const awemeList = (await fetchDouyinUserVideos(page, secUid, limit)).slice(0, limit);
        const videos = withComments
            ? await mapInBatches(awemeList, USER_VIDEO_COMMENT_CONCURRENCY, async (video) => ({
                ...video,
                top_comments: await fetchTopComments(page, video.aweme_id, commentLimit),
            }))
            : awemeList.map((video) => ({ ...video, top_comments: [] }));
        return videos.map((video, index) => {
            const playUrl = video.video?.play_addr?.url_list?.[0] ?? '';
            return {
                index: index + 1,
                aweme_id: video.aweme_id,
                title: video.desc ?? '',
                duration: Math.round((video.video?.duration ?? 0) / 1000),
                digg_count: video.statistics?.digg_count ?? 0,
                play_url: playUrl,
                top_comments: video.top_comments ?? [],
            };
        });
    },
});
