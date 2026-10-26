import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { requirePackageName, requireSort } from './utils.js';
import './search.js';
import './package.js';
import './dependents.js';
import './keywords.js';

function jsonResponse(body, init = {}) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('ohpm shared argument validation', () => {
    it('accepts scoped and unscoped package names but rejects malformed values', () => {
        expect(requirePackageName('@ohos/axios')).toBe('@ohos/axios');
        expect(requirePackageName('mobileukey')).toBe('mobileukey');
        expect(() => requirePackageName('')).toThrow(ArgumentError);
        expect(() => requirePackageName('@bad')).toThrow(ArgumentError);
        expect(() => requirePackageName('bad space')).toThrow(ArgumentError);
    });

    it('normalizes supported sort aliases and rejects unsupported API sort keys', () => {
        expect(requireSort(undefined)).toBe('relevancy');
        expect(requireSort('popular')).toBe('likes');
        expect(requireSort('newest')).toBe('latest');
        expect(() => requireSort('download')).toThrow(ArgumentError);
    });
});

describe('ohpm search adapter', () => {
    const cmd = getRegistry().get('ohpm/search');

    it('maps OHPM search rows into stable output columns', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            code: 200,
            body: {
                rows: [{
                    name: '@ohos/axios',
                    latestVersion: '2.2.10',
                    description: 'HTTP client',
                    license: 'MIT',
                    keywords: ['request', 'http'],
                    likes: 328,
                    points: 25,
                    popularity: 8631,
                    publisherName: 'SettZhao',
                    org: 'ohos',
                    latestPublishTime: 1779348839684,
                }],
            },
        })));

        const rows = await cmd.func({ query: 'axios', limit: 1, sort: 'popular' });

        expect(rows).toEqual([{
            rank: 1,
            name: '@ohos/axios',
            latestVersion: '2.2.10',
            description: 'HTTP client',
            license: 'MIT',
            keywords: 'request, http',
            likes: 328,
            points: 25,
            popularity: 8631,
            publisher: 'SettZhao',
            org: 'ohos',
            published: '2026-05-21',
            url: 'https://ohpm.openharmony.cn/#/cn/detail/%40ohos%2Faxios',
        }]);
    });

    it('maps API errors to CommandExecutionError and empty rows to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ code: 217008, message: 'Invalid sortedType!' }, { status: 400 })));
        await expect(cmd.func({ query: 'axios' })).rejects.toThrow(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ code: 200, body: { rows: [] } })));
        await expect(cmd.func({ query: 'no-such-package' })).rejects.toThrow(EmptyResultError);
    });
});

describe('ohpm package adapter', () => {
    const cmd = getRegistry().get('ohpm/package');

    it('fills missing detail description from search metadata for latest package lookup', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                code: 200,
                body: {
                    name: '@ohos/axios',
                    version: '2.2.10',
                    description: '',
                    license: 'MIT',
                    downloads: 183168,
                    keywords: ['request'],
                    publishTime: 1779348839684,
                    dependent: { total: 55 },
                    versions: { '2.2.10': 1779348839684 },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                code: 200,
                body: {
                    rows: [{ name: '@ohos/axios', description: 'Axios for OpenHarmony' }],
                },
            }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ name: '@ohos/axios' });

        expect(rows[0].description).toBe('Axios for OpenHarmony');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('ohpm dependents and keywords adapters', () => {
    it('returns one row per dependent with a caller supplied limit', async () => {
        const cmd = getRegistry().get('ohpm/dependents');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            code: 200,
            body: {
                name: '@ohos/axios',
                version: '2.2.10',
                dependent: { rows: ['a', 'b', 'c'] },
            },
        })));

        const rows = await cmd.func({ name: '@ohos/axios', limit: 2 });

        expect(rows.map((row) => row.dependent)).toEqual(['a', 'b']);
    });

    it('maps hot keywords to ranked rows', async () => {
        const cmd = getRegistry().get('ohpm/keywords');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 200, body: ['axios', 'json'] })));

        await expect(cmd.func({})).resolves.toEqual([
            { rank: 1, keyword: 'axios' },
            { rank: 2, keyword: 'json' },
        ]);
    });
});
