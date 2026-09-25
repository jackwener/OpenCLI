import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockGetDoubaoConversationList } = vi.hoisted(() => ({
    mockGetDoubaoConversationList: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getDoubaoConversationList: mockGetDoubaoConversationList,
    };
});
import { getRegistry } from '@jackwener/opencli/registry';
import './history.js';
describe('doubao history', () => {
    const history = getRegistry().get('doubao/history');
    beforeEach(() => {
        mockGetDoubaoConversationList.mockReset();
    });
    it('includes the conversation id in the tabular output', async () => {
        mockGetDoubaoConversationList.mockResolvedValue([
            {
                Id: '1234567890123',
                Title: 'Weekly Sync',
                Url: 'https://www.doubao.com/chat/1234567890123',
            },
        ]);
        const result = await history.func({}, {});
        expect(result).toEqual([
            {
                Index: 1,
                Id: '1234567890123',
                Title: 'Weekly Sync',
                Url: 'https://www.doubao.com/chat/1234567890123',
            },
        ]);
        expect(mockGetDoubaoConversationList).toHaveBeenCalledWith({}, { limit: 50 });
    });
    it('accepts a full-history limit larger than the old 1000-row cap', async () => {
        mockGetDoubaoConversationList.mockResolvedValue([
            {
                Id: '1234567890123',
                Title: 'Weekly Sync',
                Url: 'https://www.doubao.com/chat/1234567890123',
            },
        ]);
        await history.func({}, { limit: '5000' });
        expect(mockGetDoubaoConversationList).toHaveBeenCalledWith({}, { limit: 5000 });
    });
    it('rejects invalid limits before browser work', async () => {
        await expect(history.func({}, { limit: '3.5' })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        await expect(history.func({}, { limit: '5001' })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        expect(mockGetDoubaoConversationList).not.toHaveBeenCalled();
    });
    it('throws a typed empty-result error when no conversations are extracted', async () => {
        mockGetDoubaoConversationList.mockResolvedValue([]);
        await expect(history.func({}, {})).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });
});
