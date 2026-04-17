import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
import { ArgumentError } from '@jackwener/opencli/errors';
cli({
    site: 'douyin',
    name: 'hashtag',
    description: '话题搜索 / AI推荐 / 热点词',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'action', required: true, positional: true, choices: ['search', 'suggest', 'hot'], help: 'search=关键词搜索 suggest=AI推荐 hot=热点词' },
        { name: 'keyword', default: '', help: '搜索关键词（search/hot 使用）' },
        { name: 'cover', default: '', help: '封面 URI（suggest 使用）' },
        { name: 'limit', type: 'int', default: 10 },
    ],
    columns: ['name', 'id', 'view_count'],
    func: async (page, kwargs) => {
        const action = kwargs.action;
        if (action === 'search') {
            const url = `https://creator.douyin.com/aweme/v1/challenge/search/?keyword=${encodeURIComponent(kwargs.keyword)}&count=${kwargs.limit}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            return (res.challenge_list ?? []).map(c => ({
                name: c.challenge_info.cha_name,
                id: c.challenge_info.cid,
                view_count: c.challenge_info.view_count,
            }));
        }
        if (action === 'suggest') {
            const url = `https://creator.douyin.com/web/api/media/hashtag/rec/?cover_uri=${encodeURIComponent(kwargs.cover)}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            return (res.hashtag_list ?? []).map(h => ({ name: h.name, id: h.id, view_count: h.view_count }));
        }
        if (action === 'hot') {
            const kw = kwargs.keyword;
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
