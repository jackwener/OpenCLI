import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './package.js';
import './versions.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('hex-pm package adapter', () => {
    const cmd = getRegistry().get('hex-pm/package');

    it('rejects malformed package names before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ package: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'CamelCase' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'has spaces' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ package: 'unknown_pkg' })).rejects.toThrow(EmptyResultError);
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ package: 'phoenix' })).rejects.toThrow(CommandExecutionError);
    });

    it('flattens metadata + downloads + ownership into a single row', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            name: 'phoenix',
            html_url: 'https://hex.pm/packages/phoenix',
            latest_version: '1.8.6',
            latest_stable_version: '1.8.6',
            inserted_at: '2014-04-21T22:38:32.000000Z',
            updated_at: '2026-05-05T15:07:33.496465Z',
            meta: {
                description: 'Peace of mind from prototype to production',
                licenses: ['MIT'],
                links: { GitHub: 'https://github.com/phoenixframework/phoenix' },
            },
            owners: [{ username: 'chrismccord' }, { username: 'josevalim' }],
            downloads: { all: 149099814, recent: 2836250, week: 238581, day: 50838 },
            releases: [{ version: '1.8.6' }, { version: '1.8.5' }],
            docs_html_url: 'https://hexdocs.pm/phoenix/',
        }), { status: 200 })));

        const rows = await cmd.func({ package: 'phoenix' });
        expect(rows[0]).toMatchObject({
            package: 'phoenix',
            latestVersion: '1.8.6',
            licenses: 'MIT',
            github: 'https://github.com/phoenixframework/phoenix',
            owners: 'chrismccord, josevalim',
            releaseCount: 2,
            url: 'https://hex.pm/packages/phoenix',
        });
    });
});

describe('hex-pm versions adapter', () => {
    const cmd = getRegistry().get('hex-pm/versions');

    it('rejects bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ package: 'phoenix', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'phoenix', limit: 9999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves hex.pm newest-first ordering and round-trips package name', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            releases: [
                { version: '1.8.6', has_docs: true, inserted_at: '2026-05-05T14:57:20Z' },
                { version: '1.8.5', has_docs: true, inserted_at: '2026-03-05T15:22:23Z' },
                { version: '1.8.4', has_docs: false, inserted_at: '2026-02-23T17:02:40Z' },
            ],
        }), { status: 200 })));

        const rows = await cmd.func({ package: 'phoenix', limit: 10 });
        expect(rows.map((r) => r.version)).toEqual(['1.8.6', '1.8.5', '1.8.4']);
        expect(rows[0]).toMatchObject({ rank: 1, package: 'phoenix', hasDocs: true });
        expect(rows[2]).toMatchObject({ hasDocs: false });
    });

    it('throws EmptyResultError on empty releases list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ releases: [] }), { status: 200 })));
        await expect(cmd.func({ package: 'phoenix', limit: 10 })).rejects.toThrow(EmptyResultError);
    });
});
