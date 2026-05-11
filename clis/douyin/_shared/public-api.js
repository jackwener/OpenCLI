import { browserFetch } from './browser-fetch.js';
export async function fetchDouyinUserVideos(page, secUid, count) {
    const params = new URLSearchParams({
        sec_user_id: secUid,
        max_cursor: '0',
        count: String(count),
        aid: '6383',
    });
    const data = await browserFetch(page, 'GET', `https://www.douyin.com/aweme/v1/web/aweme/post/?${params.toString()}`, {
        headers: { referer: 'https://www.douyin.com/' },
    });
    return data.aweme_list || [];
}
export async function fetchDouyinComments(page, awemeId, count) {
    const params = new URLSearchParams({
        aweme_id: awemeId,
        count: String(count),
        cursor: '0',
        aid: '6383',
    });
    const data = await browserFetch(page, 'GET', `https://www.douyin.com/aweme/v1/web/comment/list/?${params.toString()}`, {
        headers: { referer: 'https://www.douyin.com/' },
    });
    return (data.comments || []).slice(0, count).map((comment) => ({
        text: comment.text || '',
        digg_count: comment.digg_count ?? 0,
        nickname: comment.user?.nickname || '',
    }));
}
