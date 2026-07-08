import { describe, expect, it, vi } from 'vitest';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './creator-stats.js';

describe('xiaohongshu creator-stats', () => {
    it('throws EmptyResultError when the requested stats period has no data', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-stats');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: {
                    seven: null,
                    thirty: {
                        view_count: 1,
                        view_list: [{ count: 1 }],
                    },
                },
            }),
        };

        await expect(cmd.func(page, { period: 'seven' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
