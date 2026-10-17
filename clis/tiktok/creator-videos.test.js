import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
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
    it('uses explicit cursor validation for follow-up pages instead of fallback-to-zero', async () => {
        const page = makePage([
            { ok: true, data: { item_list: [apiItem], has_more: true, cursor: 'bad-cursor' } },
        ]);

        await expect(creatorVideosCommand.func(page, { limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('extracts username from TikTok media URLs when author fields are absent', () => {
        expect(__test__.extractUsername({
            play_addr: ['https://example.invalid/video?user_text=test_user&x=1'],
        })).toBe('test_user');
    });
});
