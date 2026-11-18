import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, httpsUrl, parseDurationText, stripHtml } from './utils.js';
cli({
    site: 'bilibili', name: 'search', access: 'read', description: 'Search Bilibili videos or users', domain: 'www.bilibili.com', strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'type', default: 'video', help: 'video or user' },
        { name: 'page', type: 'int', default: 1, help: 'Result page' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'mid', 'score', 'plays', 'likes', 'danmaku', 'favorites', 'duration', 'duration_sec', 'pubdate_ts', 'url', 'cover', 'face', 'desc', 'name', 'sign', 'fans', 'videos', 'level', 'avatar'],
    func: async (page, kwargs) => {
        const { query: keyword, type = 'video', page: pageNum = 1, limit = 20 } = kwargs;
        const searchType = type === 'user' ? 'bili_user' : 'video';
        const payload = await apiGet(page, '/x/web-interface/wbi/search/type', { params: { search_type: searchType, keyword, page: pageNum }, signed: true });
        const results = payload?.data?.result ?? [];
        return results.slice(0, Number(limit)).map((item, i) => {
            if (searchType === 'bili_user') {
                // title / author / score / face 是历史列名，保留；name / sign / fans /
                // videos / avatar 是同一批数据的语义化列名，数字保持数字类型。
                const name = stripHtml(item.uname ?? '');
                const sign = (item.usign ?? '').trim();
                const fans = Number.isFinite(Number(item.fans)) ? Number(item.fans) : 0;
                const videos = Number.isFinite(Number(item.videos)) ? Number(item.videos) : 0;
                return {
                    rank: i + 1,
                    title: name,
                    author: sign,
                    mid: String(item.mid ?? ''),
                    score: fans,
                    name,
                    sign,
                    fans,
                    videos,
                    level: Number.isFinite(Number(item.level)) ? Number(item.level) : null,
                    url: item.mid ? `https://space.bilibili.com/${item.mid}` : '',
                    face: httpsUrl(item.upic),
                    avatar: httpsUrl(item.upic),
                };
            }
            // score 是历史列名（= item.play），保留不动；plays 是同一个数的新列名。
            return {
                rank: i + 1,
                title: stripHtml(item.title ?? ''),
                author: item.author ?? '',
                mid: String(item.mid ?? ''),
                score: item.play ?? 0,
                plays: item.play ?? 0,
                likes: item.like ?? 0,
                danmaku: item.danmaku ?? 0,
                favorites: item.favorites ?? 0,
                duration: item.duration ?? '',
                duration_sec: parseDurationText(item.duration),
                pubdate_ts: item.pubdate ?? 0,
                url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
                cover: httpsUrl(item.pic),
                face: httpsUrl(item.upic),
                desc: stripHtml(item.description ?? ''),
            };
        });
    },
});
