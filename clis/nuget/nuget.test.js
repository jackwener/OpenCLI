import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './search.js';
import './package.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('nuget search adapter', () => {
    const cmd = getRegistry().get('nuget/search');

    it('round-trips package id into nuget.org URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [{
                id: 'Newtonsoft.Json', version: '13.0.3',
                title: 'Json.NET', description: 'Json.NET is a popular high-performance JSON framework for .NET',
                authors: ['James Newton-King'], tags: ['json'], totalDownloads: 1000000, verified: true,
                projectUrl: 'https://www.newtonsoft.com/json',
            }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'json', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'Newtonsoft.Json', version: '13.0.3', verified: true,
            authors: 'James Newton-King', tags: 'json',
            url: 'https://www.nuget.org/packages/Newtonsoft.Json',
        });
    });
});

describe('nuget package adapter', () => {
    const cmd = getRegistry().get('nuget/package');

    it('follows registration stub pages instead of silently dropping old versions', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                items: [{ '@id': 'https://api.nuget.org/v3/registration5-semver1/newtonsoft.json/page/1.json' }],
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                items: [
                    { catalogEntry: { id: 'Newtonsoft.Json', version: '1.0.0', published: '2010-01-01T00:00:00Z' } },
                    { catalogEntry: { id: 'Newtonsoft.Json', version: '2.0.0', published: '2011-01-01T00:00:00Z' } },
                ],
            }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd.func({ id: 'Newtonsoft.Json' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(rows.map((r) => r.version)).toEqual(['2.0.0', '1.0.0']);
    });

});
