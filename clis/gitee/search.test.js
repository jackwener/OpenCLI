import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

function mockGiteeResponse(hits) {
    return {
        ok: true,
        json: () => Promise.resolve({ hits: { hits } }),
    };
}

function makePage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

describe('gitee search', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('emits empty-string for missing language / description instead of a sentinel', async () => {
        const cmd = getRegistry().get('gitee/search');
        expect(cmd?.func).toBeTypeOf('function');
        const fetchMock = vi.fn().mockResolvedValue(mockGiteeResponse([
            {
                fields: {
                    title: 'someuser/no-meta-repo',
                    url: 'https://gitee.com/someuser/no-meta-repo',
                },
            },
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd.func(makePage(), { keyword: 'test', limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('someuser/no-meta-repo');
        expect(rows[0].language).toBe('');
        expect(rows[0].description).toBe('');
    });

    it('passes through populated language / description verbatim', async () => {
        const cmd = getRegistry().get('gitee/search');
        const fetchMock = vi.fn().mockResolvedValue(mockGiteeResponse([
            {
                fields: {
                    title: 'org/repo-a',
                    url: 'https://gitee.com/org/repo-a',
                    langs: 'TypeScript',
                    description: 'A test repo',
                    'count.star': '42',
                },
            },
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd.func(makePage(), { keyword: 'test', limit: 10 });
        expect(rows[0].language).toBe('TypeScript');
        expect(rows[0].description).toBe('A test repo');
        expect(rows[0].stars).toBe('42');
    });
});
