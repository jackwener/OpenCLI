import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { creatorVideosCommand, __test__ } from './creator-videos.js';

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    evaluate.mockResolvedValue({ ok: true, data: { item_list: [], has_more: false } });
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

const apiItem = {
    item_id: '7350000000000000000',
    desc: 'hello\nworld',
    create_time: 1710000000,
    play_count: '123',
    like_count: '12',
    comment_count: '3',
    favorite_count: '4',
    share_count: '5',
    author: { uniqueId: 'creator' },
};

describe('tiktok/creator-videos', () => {
    it('registers a read-only browser command with stable video_id column', () => {
        expect(creatorVideosCommand.access).toBe('read');
        expect(creatorVideosCommand.browser).toBe(true);
        expect(creatorVideosCommand.columns).toEqual([
            'video_id',
            'title',
            'date',
            'views',
            'likes',
            'comments',
            'saves',
            'shares',
            'url',
        ]);
    });

    it('validates args before navigating', async () => {
        const page = makePage();

        await expect(creatorVideosCommand.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(creatorVideosCommand.func(page, { limit: 251 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(creatorVideosCommand.func(page, { cursor: 'abc' })).rejects.toBeInstanceOf(ArgumentError);

        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps TikTok Studio API rows and keeps video_id even when URL can be built', async () => {
        const page = makePage([
            { ok: true, data: { status_code: 0, status_msg: 'success', item_list: [apiItem], has_more: false } },
        ]);

        const rows = await creatorVideosCommand.func(page, { limit: 1 });

        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/tiktokstudio/content', { waitUntil: 'load', settleMs: 6000 });
        expect(rows).toEqual([{
            video_id: '7350000000000000000',
            title: 'hello world',
            date: expect.any(String),
            views: 123,
            likes: 12,
            comments: 3,
            saves: 4,
            shares: 5,
            url: 'https://www.tiktok.com/@creator/video/7350000000000000000',
        }]);
    });

    it('uses explicit cursor validation for follow-up pages instead of fallback-to-zero', async () => {
        const page = makePage([
            { ok: true, data: { item_list: [apiItem], has_more: true, cursor: 'bad-cursor' } },
        ]);

        await expect(creatorVideosCommand.func(page, { limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('maps auth, API, empty, and missing-id states to typed errors', async () => {
        await expect(creatorVideosCommand.func(makePage([
            { ok: false, status: 403, statusText: 'Forbidden' },
        ]), { limit: 1 })).rejects.toBeInstanceOf(AuthRequiredError);

        await expect(creatorVideosCommand.func(makePage([
            { ok: true, data: { status_code: 1001, status_msg: 'creator permission denied' } },
        ]), { limit: 1 })).rejects.toBeInstanceOf(AuthRequiredError);

        await expect(creatorVideosCommand.func(makePage([
            { ok: true, data: { status_code: 500, status_msg: 'internal error' } },
        ]), { limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(creatorVideosCommand.func(makePage([
            { ok: true, data: { item_list: [], has_more: false } },
        ]), { limit: 1 })).rejects.toBeInstanceOf(EmptyResultError);

        await expect(creatorVideosCommand.func(makePage([
            { ok: true, data: { item_list: [{ desc: 'missing id' }], has_more: false } },
        ]), { limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('extracts username from TikTok media URLs when author fields are absent', () => {
        expect(__test__.extractUsername({
            play_addr: ['https://example.invalid/video?user_text=test_user&x=1'],
        })).toBe('test_user');
    });
});
