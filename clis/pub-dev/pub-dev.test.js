import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './package.js';
import './versions.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('pub-dev package adapter', () => {
    const cmd = getRegistry().get('pub-dev/package');

    it('rejects malformed package names before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ package: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'Invalid-Name' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: '0starts_digit' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 (unknown package) to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ package: 'no_such_package' })).rejects.toThrow(EmptyResultError);
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ package: 'http' })).rejects.toThrow(CommandExecutionError);
    });

    it('flattens latest pubspec into a single row', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            name: 'http',
            latest: {
                version: '1.6.0',
                published: '2025-11-10T18:27:56.434747Z',
                archive_url: 'https://pub.dev/api/archives/http-1.6.0.tar.gz',
                pubspec: {
                    description: 'A composable HTTP client.',
                    repository: 'https://github.com/dart-lang/http',
                    topics: ['http', 'network'],
                    environment: { sdk: '^3.4.0' },
                    dependencies: { async: '^2.5.0', meta: '^1.3.0' },
                    dev_dependencies: { test: '^1.21.2' },
                },
            },
        }), { status: 200 })));

        const rows = await cmd.func({ package: 'http' });
        expect(rows[0]).toMatchObject({
            package: 'http',
            version: '1.6.0',
            description: 'A composable HTTP client.',
            sdk: '^3.4.0',
            dependencies: 'async, meta',
            devDependencies: 'test',
            topics: 'http, network',
            url: 'https://pub.dev/packages/http',
        });
    });
});

describe('pub-dev versions adapter', () => {
    const cmd = getRegistry().get('pub-dev/versions');

    it('rejects bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ package: 'http', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'http', limit: 9999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reverses pub.dev oldest-first list to newest-first and round-trips package name', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            versions: [
                { version: '0.1.0', published: '2020-01-01T00:00:00Z', archive_url: 'a' },
                { version: '0.2.0', published: '2021-01-01T00:00:00Z', archive_url: 'b' },
                { version: '1.0.0', published: '2024-01-01T00:00:00Z', archive_url: 'c' },
            ],
        }), { status: 200 })));

        const rows = await cmd.func({ package: 'http', limit: 10 });
        expect(rows.map((r) => r.version)).toEqual(['1.0.0', '0.2.0', '0.1.0']);
        expect(rows[0]).toMatchObject({ rank: 1, package: 'http', publishedAt: '2024-01-01T00:00:00Z' });
    });

    it('throws EmptyResultError on empty versions list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ versions: [] }), { status: 200 })));
        await expect(cmd.func({ package: 'http', limit: 10 })).rejects.toThrow(EmptyResultError);
    });
});
