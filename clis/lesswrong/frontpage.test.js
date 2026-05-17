import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { gqlRequestMock } = vi.hoisted(() => ({ gqlRequestMock: vi.fn() }));
vi.mock('./_helpers.js', async () => {
    const actual = await vi.importActual('./_helpers.js');
    return { ...actual, gqlRequest: gqlRequestMock };
});

import './frontpage.js';

describe('lesswrong frontpage', () => {
    beforeEach(() => {
        gqlRequestMock.mockReset();
    });

    it('emits empty-string for missing user.displayName instead of a sentinel', async () => {
        const command = getRegistry().get('lesswrong/frontpage');
        expect(command?.func).toBeDefined();
        gqlRequestMock.mockResolvedValueOnce({
            posts: {
                results: [
                    { _id: 'a1', slug: 'post-a', title: 'Has author', user: { displayName: 'Real Person' }, baseScore: 10, commentCount: 3 },
                    { _id: 'b2', slug: 'post-b', title: 'Deleted user', user: null, baseScore: 5, commentCount: 0 },
                    { _id: 'c3', slug: 'post-c', title: 'Missing name', user: {}, baseScore: 7, commentCount: 1 },
                ],
            },
        });
        const rows = await command.func({ limit: 3 });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ rank: 1, title: 'Has author', author: 'Real Person', karma: 10, comments: 3 });
        expect(rows[1].author).toBe('');
        expect(rows[1].title).toBe('Deleted user');
        expect(rows[2].author).toBe('');
        expect(rows[2].title).toBe('Missing name');
    });
});
