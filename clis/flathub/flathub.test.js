import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './app.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('flathub search adapter', () => {
    const cmd = getRegistry().get('flathub/search');

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('throttled', { status: 429 })));
        await expect(cmd.func({ query: 'firefox' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty hits', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'no-such-app' })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips appId into flathub.org URL and normalises updated_at unix-seconds to ISO', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            hits: [{
                app_id: 'org.mozilla.firefox', name: 'Firefox', summary: 'Web browser',
                developer_name: 'Mozilla', project_license: 'MPL-2.0', is_free_license: true,
                main_categories: 'network', installs_last_month: 100000,
                updated_at: 1730000000,
            }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'firefox', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, appId: 'org.mozilla.firefox', name: 'Firefox',
            license: 'MPL-2.0', isFreeLicense: true, mainCategories: 'network',
            installsLastMonth: 100000, updatedAt: '2024-10-27',
            url: 'https://flathub.org/apps/org.mozilla.firefox',
        });
    });
});

describe('flathub app adapter', () => {
    const cmd = getRegistry().get('flathub/app');

    it('rejects malformed appId before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ appId: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ appId: 'no-dot' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ appId: '.starts.with.dot' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
        await expect(cmd.func({ appId: 'org.example.does-not-exist' })).rejects.toThrow(EmptyResultError);
    });

    it('handles releases with string-typed timestamps (flathub appstream quirk)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: 'org.mozilla.firefox', name: 'Firefox', summary: 'Web browser',
            developer_name: 'Mozilla', project_license: 'MPL-2.0', is_free_license: true,
            categories: ['Network', 'WebBrowser'], keywords: ['Browser'],
            urls: { homepage: 'https://www.mozilla.org/firefox/' },
            releases: [
                // upstream emits these as numeric strings, not numbers
                { version: '150.0.1', timestamp: '1777248000', type: 'stable' },
                { version: '149.0.0', timestamp: '1770000000', type: 'stable' },
            ],
        }), { status: 200 })));
        const rows = await cmd.func({ appId: 'org.mozilla.firefox' });
        expect(rows[0]).toMatchObject({
            appId: 'org.mozilla.firefox', name: 'Firefox',
            categories: 'Network, WebBrowser',
            latestVersion: '150.0.1', latestReleaseDate: '2026-04-27',
            homepage: 'https://www.mozilla.org/firefox/',
            url: 'https://flathub.org/apps/org.mozilla.firefox',
        });
    });
});
