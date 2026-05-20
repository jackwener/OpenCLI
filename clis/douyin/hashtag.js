import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
import { ArgumentError } from '@jackwener/opencli/errors';
cli({
    site: 'douyin',
    name: 'hashtag',
    access: 'read',
    description: '话题搜索 / AI推荐 / 热点词',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'action', required: true, positional: true, choices: ['search', 'suggest', 'hot'], help: 'search=关键词搜索 (--keyword 必填), suggest=AI推荐 (--cover 必填), hot=热点词 (--keyword 可选)' },
        { name: 'keyword', default: '', help: '搜索关键词. search 必填; hot 可选; suggest 不使用 (传 --cover)' },
        { name: 'cover', default: '', help: '封面 URI (cover_uri). suggest 必填; 其它 action 不使用' },
        { name: 'limit', type: 'int', default: 10 },
    ],
    columns: ['name', 'id', 'view_count'],
    func: async (page, kwargs) => {
        const action = kwargs.action;
        if (action === 'search') {
            const keyword = String(kwargs.keyword ?? '').trim();
            if (!keyword) {
                throw new ArgumentError('douyin hashtag search 需要 --keyword <关键词>', '示例: opencli douyin hashtag search --keyword 美食');
            }
            const url = `https://creator.douyin.com/aweme/v1/challenge/search/?keyword=${encodeURIComponent(keyword)}&count=${kwargs.limit}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            return (res.challenge_list ?? []).map(c => ({
                name: c.challenge_info.cha_name,
                id: c.challenge_info.cid,
                view_count: c.challenge_info.view_count,
            }));
        }
        if (action === 'suggest') {
            const cover = String(kwargs.cover ?? '').trim();
            if (!cover) {
                throw new ArgumentError('douyin hashtag suggest 需要 --cover <cover_uri>', 'suggest 基于已上传的视频封面做 AI 推荐, 不是关键词搜索. 关键词搜索请用 `douyin hashtag search --keyword <词>`.');
            }
            const url = `https://creator.douyin.com/web/api/media/hashtag/rec/?cover_uri=${encodeURIComponent(cover)}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            return (res.hashtag_list ?? []).map(h => ({ name: h.name, id: h.id, view_count: h.view_count }));
        }
        if (action === 'hot') {
            const kw = String(kwargs.keyword ?? '').trim();
            const url = `https://creator.douyin.com/aweme/v1/hotspot/recommend/?${kw ? `keyword=${encodeURIComponent(kw)}&` : ''}aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            const items = res.hotspot_list
                ?? res.all_sentences?.map(h => ({
                    sentence: h.word ?? '',
                    hot_value: h.hot_value,
                    sentence_id: h.sentence_id ?? '',
                }))
                ?? [];
            return items.slice(0, kwargs.limit).map(h => ({
                name: h.sentence,
                id: 'sentence_id' in h ? h.sentence_id : '',
                view_count: h.hot_value,
            }));
        }
        throw new ArgumentError(`未知的 action: ${action}`);
    },
});
