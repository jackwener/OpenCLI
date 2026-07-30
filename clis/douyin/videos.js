import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { browserFetch } from './_shared/browser-fetch.js';
const WORK_LIST_URL = 'https://creator.douyin.com/janus/douyin/creator/pc/work_list';
// The server caps how many works come back per request regardless of page_size,
// so collecting a large --limit takes several cursor hops.
const MAX_HOPS = 50;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = MAX_HOPS * 50;
function isScheduledWork(work) {
    return (work.public_time ?? 0) > Date.now() / 1000;
}
function countEligibleWorks(items, status) {
    return status === 'scheduled' ? items.filter(isScheduledWork).length : items.length;
}
export function normalizeVideosLimit(raw) {
    const value = raw === undefined || raw === null || raw === '' ? DEFAULT_LIMIT : Number(raw);
    if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
        throw new ArgumentError(`douyin videos limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
    }
    return value;
}
function pageSizeForLimit(limit) {
    if (limit < 20)
        return 20;
    if (limit > 50)
        return 50;
    return limit;
}
function normalizeVideoStatus(status, publicTime) {
    if (typeof status === 'number')
        return status;
    if (!status)
        return publicTime && publicTime > Date.now() / 1000 ? 'scheduled' : 'published';
    if (status.is_delete)
        return 'deleted';
    if (status.is_prohibited)
        return 'prohibited';
    if (status.in_reviewing)
        return 'reviewing';
    if (status.is_private)
        return 'private';
    if (publicTime && publicTime > Date.now() / 1000)
        return 'scheduled';
    return 'published';
}
cli({
    site: 'douyin',
    name: 'videos',
    access: 'read',
    description: '获取作品列表',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: '最多返回多少个作品（跨页自动收集）' },
        { name: 'status', default: 'all', choices: ['all', 'published', 'reviewing', 'scheduled'] },
    ],
    columns: [
        'aweme_id',
        'title',
        'status',
        'play_count',
        'digg_count',
        'comment_count',
        'collect_count',
        'share_count',
        'duration',
        'create_time',
    ],
    func: async (page, kwargs) => {
        const statusMap = { all: 0, published: 1, reviewing: 3, scheduled: 0 };
        const statusNum = statusMap[kwargs.status] ?? 0;
        const limit = normalizeVideosLimit(kwargs.limit);
        const pageSize = pageSizeForLimit(limit);
        // work_list is cursor-paginated: it ignores page_num and advances through max_cursor.
        // Walk the cursor until the server stops reporting has_more.
        const items = [];
        const seenAwemeIds = new Set();
        let cursor;
        for (let hop = 0; hop < MAX_HOPS && countEligibleWorks(items, kwargs.status) < limit; hop++) {
            const params = new URLSearchParams({
                page_size: String(pageSize),
                status: String(statusNum),
            });
            if (cursor !== undefined)
                params.set('max_cursor', String(cursor));
            const res = (await browserFetch(page, 'GET', `${WORK_LIST_URL}?${params.toString()}`));
            const payload = res.data && typeof res.data === 'object' ? res.data : res;
            const batch = payload.work_list ?? payload.aweme_list ?? res.work_list ?? res.aweme_list ?? [];
            if (batch.length === 0)
                break;
            for (const work of batch) {
                const awemeId = work?.aweme_id == null ? '' : String(work.aweme_id);
                if (awemeId && seenAwemeIds.has(awemeId))
                    continue;
                if (awemeId)
                    seenAwemeIds.add(awemeId);
                items.push(work);
            }
            const nextCursor = payload.max_cursor ?? res.max_cursor;
            const hasMore = payload.has_more ?? res.has_more;
            if (!hasMore || nextCursor === undefined || nextCursor === null
                || (cursor !== undefined && String(nextCursor) === String(cursor)))
                break;
            cursor = nextCursor;
        }
        let rows = items;
        // The API has a bug with status=16 for scheduled, so filter client-side
        if (kwargs.status === 'scheduled') {
            rows = rows.filter(isScheduledWork);
        }
        return rows.slice(0, limit).map((v) => ({
            aweme_id: v.aweme_id,
            title: v.desc ?? '',
            status: normalizeVideoStatus(v.status, v.public_time),
            play_count: v.statistics?.play_count ?? 0,
            digg_count: v.statistics?.digg_count ?? 0,
            comment_count: v.statistics?.comment_count ?? 0,
            collect_count: v.statistics?.collect_count ?? 0,
            share_count: v.statistics?.share_count ?? 0,
            duration: v.duration ?? 0,
            create_time: new Date((v.create_time ?? v.public_time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
        }));
    },
});
