import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { wikiFetchMock } = vi.hoisted(() => ({ wikiFetchMock: vi.fn() }));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return { ...actual, wikiFetch: wikiFetchMock };
});

import './trending.js';

describe('wikipedia trending', () => {
    beforeEach(() => {
        wikiFetchMock.mockReset();
    });

    it('emits empty-string for missing title and description instead of a sentinel', async () => {
        const command = getRegistry().get('wikipedia/trending');
        expect(command?.func).toBeDefined();
        wikiFetchMock.mockResolvedValueOnce({
            mostread: {
                articles: [
                    { title: 'Has_Both', description: 'A real description', views: 100 },
                    { views: 50 },
                    { title: 'Has_Title_Only', views: 25 },
                ],
            },
        });
        const rows = await command.func({ limit: 5, lang: 'en' });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ title: 'Has_Both', description: 'A real description', views: 100 });
        expect(rows[1].title).toBe('');
        expect(rows[1].description).toBe('');
        expect(rows[2].title).toBe('Has_Title_Only');
        expect(rows[2].description).toBe('');
    });
});
