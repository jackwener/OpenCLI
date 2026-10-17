import { cli, Strategy } from '@jackwener/opencli/registry';
import { log } from '@jackwener/opencli/logger';
import { apiGet, httpsUrl, parseDurationText, payloadData, resolveUid } from './utils.js';

/** medialist 单页上限。 */
const MEDIALIST_MAX_PAGE_SIZE = 50;

/**
 * arc/search 的 vlist[] 根本没有点赞字段（实测 item.like 恒 undefined），旧代码
 * `likes: item.like ?? 0` 于是让每条都显示 0 —— 看着像"零赞"，其实是"没这个数据"。
 *
 * medialist（空间"播放全部"用的那个接口）按同样的发布时间倒序列出该 UP 主的稿件，
 * cnt_info.thumb_up 就是点赞数：**整页一次请求**补齐，不是每条一次。
 * oid 用当前页第一条 aid 锚定（with_current=true 从该条开始往后取），pn > 1 也对得上。
 *
 * 返回 aid → 点赞数 的 Map。没被覆盖到的条目（例如 --order click / stow 时两边
 * 排序不同）由调用方标成 likes_known: false，不假装是 0。
 */
async function fetchLikesByAid(page, mid, anchorAid, pageSize) {
    // medialist 会漏掉一部分稿件（付费课程、充电专属之类），窗口取得比本页条数
    // 大一些，免得被漏掉的条目把后面几条挤出窗口。仍然只是一次请求。
    const windowSize = Math.min(pageSize * 2 + 5, MEDIALIST_MAX_PAGE_SIZE);
    const params = {
        type: 1,
        biz_id: mid,
        otype: 2,
        ps: windowSize,
        direction: false,
        sort_field: 1,
        desc: true,
        tid: 0,
        with_current: true,
    };
    if (anchorAid) params.oid = anchorAid;
    const payload = await apiGet(page, '/x/v2/medialist/resource/list', { params });
    const mediaList = payloadData(payload)?.media_list;
    const likes = new Map();
    if (!Array.isArray(mediaList)) return likes;
    for (const media of mediaList) {
        const aid = String(media?.id ?? '');
        const thumbUp = media?.cnt_info?.thumb_up;
        if (aid && typeof thumbUp === 'number') likes.set(aid, thumbUp);
    }
    return likes;
}
cli({
    site: 'bilibili',
    name: 'user-videos',
    access: 'read',
    description: '查看指定用户的投稿视频',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', required: true, positional: true, help: 'User UID or username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
        { name: 'order', default: 'pubdate', help: 'Sort: pubdate, click, stow' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
    ],
    columns: ['rank', 'title', 'plays', 'likes', 'likes_known', 'comments', 'danmaku', 'date', 'created_ts', 'duration', 'duration_sec', 'url', 'bvid', 'cover', 'desc', 'is_pay'],
    func: async (page, kwargs) => {
        const { uid: uidInput, limit = 20, order = 'pubdate', page: pageNum = 1 } = kwargs;
        const uid = await resolveUid(page, String(uidInput));
        const payload = await apiGet(page, '/x/space/wbi/arc/search', {
            params: {
                mid: uid,
                pn: pageNum,
                ps: Math.min(Number(limit), 50),
                order,
            },
            signed: true,
        });
        const vlist = payloadData(payload)?.list?.vlist ?? [];
        const items = vlist.slice(0, Number(limit));

        // 点赞数补齐（见 fetchLikesByAid）。这一步失败不该让整条命令挂掉——
        // likes_known 会如实标成 false，同时 warn 一声，不静默降级。
        let likesByAid = new Map();
        if (items.length > 0) {
            try {
                likesByAid = await fetchLikesByAid(page, uid, items[0]?.aid, items.length);
            }
            catch (error) {
                log.warn(`Bilibili medialist like lookup failed (${error?.message ?? error}); likes reported as unknown`);
            }
        }

        return items.map((item, i) => {
            const likes = likesByAid.get(String(item.aid ?? ''));
            return {
                rank: i + 1,
                title: item.title ?? '',
                plays: item.play ?? 0,
                // vlist 不带点赞，likes 来自 medialist；没对上的条目 likes_known=false。
                likes: likes ?? 0,
                likes_known: likes !== undefined,
                comments: item.comment ?? 0,
                // vlist 里弹幕数的字段名是 video_review，不是 danmaku。
                danmaku: item.video_review ?? 0,
                // date 只到天（保留不动），created_ts 是接口原始的 unix 秒。
                date: item.created ? new Date(item.created * 1000).toISOString().slice(0, 10) : '',
                created_ts: item.created ?? 0,
                duration: item.length ?? '',
                duration_sec: parseDurationText(item.length),
                url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
                bvid: item.bvid ?? '',
                cover: httpsUrl(item.pic),
                desc: item.description ?? '',
                // 付费 / 合作稿件：ml-scout 用它替掉精选阶段单独打 video 接口拿 paid_content。
                is_pay: !!item.is_pay,
            };
        });
    },
});
