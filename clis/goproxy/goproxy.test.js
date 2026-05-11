import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './module.js';
import './versions.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('goproxy module adapter', () => {
    const cmd = getRegistry().get('goproxy/module');

    it('rejects malformed module path before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ module: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ module: 'noslash' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ module: 'has spaces/foo' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 410 (gone, e.g. retracted) to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 410 })));
        await expect(cmd.func({ module: 'github.com/foo/bar' })).rejects.toThrow(EmptyResultError);
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ module: 'github.com/foo/bar' })).rejects.toThrow(CommandExecutionError);
    });

    it('returns latest version with origin metadata', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            Version: 'v1.12.0',
            Time: '2026-02-28T10:10:09Z',
            Origin: { VCS: 'git', URL: 'https://github.com/gin-gonic/gin', Hash: 'abc123', Ref: 'refs/tags/v1.12.0' },
        }), { status: 200 })));

        const rows = await cmd.func({ module: 'github.com/gin-gonic/gin' });
        expect(rows).toEqual([expect.objectContaining({
            module: 'github.com/gin-gonic/gin',
            version: 'v1.12.0',
            publishedAt: '2026-02-28T10:10:09Z',
            vcs: 'git',
            commit: 'abc123',
        })]);
    });
});

describe('goproxy versions adapter', () => {
    const cmd = getRegistry().get('goproxy/versions');

    it('rejects bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ module: 'github.com/foo/bar', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ module: 'github.com/foo/bar', limit: 500 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when @v/list is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
        await expect(cmd.func({ module: 'github.com/foo/bar', limit: 5 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('sorts version tags semver-descending and round-trips module path', async () => {
        // Note: this list is intentionally unsorted in calendar order.
        const list = [
            'v1.9.0', 'v1.10.0', 'v1.2.0', 'v1.10.1', 'v0.0.1', 'v2.0.0',
            'v2.0.0-rc.2', 'v2.0.0-rc.10',
        ].join('\n');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(list, { status: 200 })));

        const rows = await cmd.func({ module: 'github.com/foo/bar', limit: 10 });
        expect(rows.map((r) => r.version)).toEqual([
            'v2.0.0', 'v2.0.0-rc.10', 'v2.0.0-rc.2',
            'v1.10.1', 'v1.10.0', 'v1.9.0', 'v1.2.0', 'v0.0.1',
        ]);
        // module column round-trips to goproxy module <module>
        expect(rows[0]).toMatchObject({ rank: 1, module: 'github.com/foo/bar', publishedAt: null });
    });

    it('fetches publish times only when --with-time is set', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('v1.0.0\nv0.9.0', { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ Time: '2024-01-02T03:04:05Z' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ Time: '2023-12-31T01:02:03Z' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ module: 'github.com/foo/bar', limit: 2, 'with-time': true });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(rows.map((r) => [r.version, r.publishedAt])).toEqual([
            ['v1.0.0', '2024-01-02T03:04:05Z'],
            ['v0.9.0', '2023-12-31T01:02:03Z'],
        ]);
    });
});
