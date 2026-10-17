import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './module.js';
import './versions.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('goproxy versions adapter', () => {
    const cmd = getRegistry().get('goproxy/versions');

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

});
