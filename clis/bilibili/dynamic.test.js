import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockApiGet } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
}));
vi.mock('./utils.js', () => ({
    apiGet: mockApiGet,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './dynamic.js';
describe('bilibili dynamic adapter', () => {
    const command = getRegistry().get('bilibili/dynamic');
    beforeEach(() => {
        mockApiGet.mockReset();
    });
    it('maps desc text rows from the dynamic feed payload', async () => {
        mockApiGet.mockResolvedValue({
            data: {
                items: [
                    {
                        id_str: '123',
                        modules: {
                            module_author: { name: 'Alice' },
                            module_dynamic: { desc: { text: 'hello world' } },
                            module_stat: { like: { count: 9 } },
                        },
                    },
                ],
            },
        });
        const result = await command.func({}, { limit: 5 });
        expect(mockApiGet).toHaveBeenCalledWith({}, '/x/polymer/web-dynamic/v1/feed/all', { params: {}, signed: false });
        expect(result).toEqual([
            {
                id: '123',
                author: 'Alice',
                text: 'hello world',
                likes: 9,
                url: 'https://t.bilibili.com/123',
            },
        ]);
    });
    it('falls back to archive title when desc text is absent', async () => {
        mockApiGet.mockResolvedValue({
            data: {
                items: [
                    {
                        id_str: '456',
                        modules: {
                            module_author: { name: 'Bob' },
                            module_dynamic: { major: { archive: { title: 'Video title' } } },
                            module_stat: { like: { count: 3 } },
                        },
                    },
                ],
            },
        });
        const result = await command.func({}, { limit: 5 });
        expect(result).toEqual([
            {
                id: '456',
                author: 'Bob',
                text: 'Video title',
                likes: 3,
                url: 'https://t.bilibili.com/456',
            },
        ]);
    });
});
