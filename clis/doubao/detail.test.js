import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockGetConversationDetail } = vi.hoisted(() => ({
    mockGetConversationDetail: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getConversationDetail: mockGetConversationDetail,
    };
});
import { getRegistry } from '@jackwener/opencli/registry';
import './detail.js';
describe('doubao detail', () => {
    const detail = getRegistry().get('doubao/detail');
    beforeEach(() => {
        mockGetConversationDetail.mockReset();
    });
    it('returns meeting metadata even when the conversation has no chat messages', async () => {
        mockGetConversationDetail.mockResolvedValue({
            messages: [],
            meeting: {
                title: 'Weekly Sync',
                time: '2026-03-28 10:00',
            },
        });
        const result = await detail.func({}, { id: '1234567890', 'max-pages': 500 });
        expect(mockGetConversationDetail).toHaveBeenCalledWith({}, '1234567890', { maxPages: 500 });
        expect(result).toEqual([
            {
                Index: 0,
                MessageId: '',
                Role: 'Meeting',
                Type: 'meeting',
                Mode: '',
                CreatedAt: null,
                Text: 'Weekly Sync (2026-03-28 10:00)',
                Metadata: '{}',
            },
        ]);
    });
    it('returns an empty result when the API proves a conversation is complete but has no messages', async () => {
        mockGetConversationDetail.mockResolvedValue({
            messages: [],
            meeting: null,
            captureComplete: true,
            hasMore: false,
        });
        await expect(detail.func({}, { id: '1234567890', 'max-pages': 500 })).resolves.toEqual([]);
    });
    it('rejects invalid max-pages without silently clamping it', async () => {
        await expect(detail.func({}, { id: '1234567890', 'max-pages': 0 })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
    });
});
