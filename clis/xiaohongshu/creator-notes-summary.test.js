import { describe, expect, it, vi } from 'vitest';
import { summarizeCreatorNote } from './creator-notes-summary.js';
import { getRegistry } from '@jackwener/opencli/registry';
import * as creatorNotesModule from './creator-notes.js';
import * as creatorDetailModule from './creator-note-detail.js';
import './creator-notes-summary.js';
describe('xiaohongshu creator-notes-summary', () => {
    it('summarizes note list row and detail rows into one compact row', () => {
        const note = {
            id: 'cccccccccccccccccccccccc',
            title: '示例内容复盘',
            date: '2026年03月18日 20:01',
            views: 549,
            likes: 19,
            collects: 10,
            comments: 7,
            url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=cccccccccccccccccccccccc',
        };
        const rows = [
            { section: '笔记信息', metric: 'published_at', value: '2026-03-18 20:01', extra: '' },
            { section: '基础数据', metric: '观看数', value: '549', extra: '' },
            { section: '互动数据', metric: '点赞数', value: '19', extra: '' },
            { section: '互动数据', metric: '收藏数', value: '10', extra: '' },
            { section: '互动数据', metric: '评论数', value: '7', extra: '' },
            { section: '互动数据', metric: '分享数', value: '6', extra: '' },
            { section: '基础数据', metric: '平均观看时长', value: '51.5秒', extra: '' },
            { section: '基础数据', metric: '涨粉数', value: '3', extra: '' },
            { section: '观看来源', metric: '首页推荐', value: '89.9%', extra: '' },
            { section: '观看来源', metric: '搜索', value: '0.3%', extra: '' },
            { section: '观众画像', metric: '兴趣/二次元', value: '13%', extra: '' },
            { section: '观众画像', metric: '兴趣/游戏', value: '11%', extra: '' },
        ];
        expect(summarizeCreatorNote(note, rows, 1)).toEqual({
            rank: 1,
            id: 'cccccccccccccccccccccccc',
            title: '示例内容复盘',
            published_at: '2026-03-18 20:01',
            views: '549',
            likes: '19',
            collects: '10',
            comments: '7',
            shares: '6',
            avg_view_time: '51.5秒',
            rise_fans: '3',
            top_source: '首页推荐',
            top_source_pct: '89.9%',
            top_interest: '二次元',
            top_interest_pct: '13%',
            url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=cccccccccccccccccccccccc',
        });
    });
    it('waits between note detail fetches after the first note', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-notes-summary');
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
        };
        vi.spyOn(creatorNotesModule, 'fetchCreatorNotes').mockResolvedValue([
            {
                id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
                title: 'n1',
                date: '2026年03月18日 20:01',
                views: 1,
                likes: 1,
                collects: 1,
                comments: 1,
                url: 'u1',
            },
            {
                id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
                title: 'n2',
                date: '2026年03月19日 20:01',
                views: 2,
                likes: 2,
                collects: 2,
                comments: 2,
                url: 'u2',
            },
        ]);
        vi.spyOn(creatorDetailModule, 'fetchCreatorNoteDetailRows').mockResolvedValue([
            { section: '笔记信息', metric: 'published_at', value: '2026-03-18 20:01', extra: '' },
            { section: '基础数据', metric: '观看数', value: '1', extra: '' },
        ]);
        await cmd.func(page, { limit: 2 });
        expect(page.wait).toHaveBeenCalledWith(expect.objectContaining({ time: expect.any(Number) }));
        expect(page.wait.mock.calls).toHaveLength(1);
    });
});
