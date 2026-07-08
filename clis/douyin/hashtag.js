import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireListField(res, field, action) {
    if (!isPlainObject(res)) {
        throw new CommandExecutionError(`douyin hashtag ${action}: API returned malformed payload`);
    }
    const list = res[field];
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) {
        throw new CommandExecutionError(`douyin hashtag ${action}: API returned malformed "${field}"`);
    }
    return list;
}

function validateHashtagArgs(kwargs) {
    const action = kwargs.action;
    if (action === 'search') {
        const keyword = String(kwargs.keyword ?? '').trim();
        if (!keyword) {
            throw new ArgumentError('douyin hashtag search 需要 --keyword <关键词>', '示例: opencli douyin hashtag search --keyword 美食');
        }
        return;
    }
    if (action === 'suggest') {
        const cover = String(kwargs.cover ?? '').trim();
        if (!cover) {
            throw new ArgumentError('douyin hashtag suggest 需要 --cover <cover_uri>', 'suggest 基于已上传的视频封面做 AI 推荐, 不是关键词搜索. 关键词搜索请用 `douyin hashtag search --keyword <词>`.');
        }
    }
}

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
    validateArgs: validateHashtagArgs,
    func: async (page, kwargs) => {
        validateHashtagArgs(kwargs);
        const action = kwargs.action;
        if (action === 'search') {
            const keyword = String(kwargs.keyword ?? '').trim();
            const url = `https://creator.douyin.com/aweme/v1/challenge/search/?keyword=${encodeURIComponent(keyword)}&count=${kwargs.limit}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            const list = requireListField(res, 'challenge_list', 'search');
            const rows = list.flatMap(c => {
                const info = c?.challenge_info;
                if (!isPlainObject(info)) return [];
                return [{
                    name: info.cha_name,
                    id: info.cid,
                    view_count: info.view_count,
                }];
            });
            if (list.length > 0 && rows.length === 0) {
                throw new CommandExecutionError('douyin hashtag search: API returned challenges but none had stable challenge_info shape');
            }
            return rows;
        }
        if (action === 'suggest') {
            const cover = String(kwargs.cover ?? '').trim();
            const url = `https://creator.douyin.com/web/api/media/hashtag/rec/?cover_uri=${encodeURIComponent(cover)}&aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            const list = requireListField(res, 'hashtag_list', 'suggest');
            return list.map(h => ({ name: h?.name ?? '', id: h?.id ?? '', view_count: h?.view_count ?? 0 }));
        }
        if (action === 'hot') {
            const kw = String(kwargs.keyword ?? '').trim();
            const url = `https://creator.douyin.com/aweme/v1/hotspot/recommend/?${kw ? `keyword=${encodeURIComponent(kw)}&` : ''}aid=1128`;
            const res = await browserFetch(page, 'GET', url);
            if (!isPlainObject(res)) {
                throw new CommandExecutionError('douyin hashtag hot: API returned malformed payload');
            }
            const hotspotList = res.hotspot_list;
            const allSentences = res.all_sentences;
            if (hotspotList !== undefined && hotspotList !== null && !Array.isArray(hotspotList)) {
                throw new CommandExecutionError('douyin hashtag hot: API returned malformed "hotspot_list"');
            }
            if (allSentences !== undefined && allSentences !== null && !Array.isArray(allSentences)) {
                throw new CommandExecutionError('douyin hashtag hot: API returned malformed "all_sentences"');
            }
            const items = Array.isArray(hotspotList)
                ? hotspotList
                : Array.isArray(allSentences)
                    ? allSentences.map(h => ({
                        sentence: h?.word ?? '',
                        hot_value: h?.hot_value,
                        sentence_id: h?.sentence_id ?? '',
                    }))
                    : [];
            return items.slice(0, kwargs.limit).map(h => ({
                name: h?.sentence ?? '',
                id: h && 'sentence_id' in h ? h.sentence_id : '',
                view_count: h?.hot_value ?? 0,
            }));
        }
        throw new ArgumentError(`未知的 action: ${action}`);
    },
});
