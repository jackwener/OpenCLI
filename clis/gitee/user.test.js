import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './user.js';
const command = getRegistry().get('gitee/user');
function createPage(snapshot) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(snapshot),
    };
}
describe('gitee user', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
    it('registers the gitee user command', () => {
        expect(command).toMatchObject({
            site: 'gitee',
            name: 'user',
        });
    });
    it('does not mislabel contribution totals as Gitee Index when the real index is unavailable', async () => {
        const page = createPage({
            notFound: false,
            blocked: false,
            nickname: 'Alice',
            followers: '12',
            publicRepos: '7',
            giteeIndex: '',
            contributionTotal: 321,
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            login: 'alice',
            name: 'Alice',
            followers: 12,
            public_repos: 7,
        }), { status: 200 })));
        const rows = await command.func(page, { username: 'alice' });
        expect(rows).toContainEqual({ field: 'Gitee Index', value: '-' });
    });
    it('uses an API-provided Gitee Index when available', async () => {
        const page = createPage({
            notFound: false,
            blocked: false,
            nickname: '',
            followers: '',
            publicRepos: '',
            giteeIndex: '',
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            login: 'alice',
            followers: 9,
            public_repos: 3,
            gitee_index: 88,
        }), { status: 200 })));
        const rows = await command.func(page, { username: 'alice' });
        expect(rows).toContainEqual({ field: 'Gitee Index', value: '88' });
    });
});
