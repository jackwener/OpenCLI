import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './topics.js';
describe('zsxq topics command', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    it('requires an explicit group_id when there is no active group context', async () => {
        const command = getRegistry().get('zsxq/topics');
        expect(command?.func).toBeTypeOf('function');
        const mockPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(null),
        };
        await expect(command.func(mockPage, { limit: 20 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: 'Cannot determine active group_id',
        });
        expect(mockPage.goto).toHaveBeenCalledWith('https://wx.zsxq.com');
        expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });
});
