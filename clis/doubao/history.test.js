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
    });
});
