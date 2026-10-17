import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './vulnerability.js';
import './query.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('osv query adapter', () => {
    const cmd = getRegistry().get('osv/query');

    it('sorts by published date descending and rows have id round-tripable into osv vulnerability', async () => {
        const body = {
            vulns: [
                { id: 'GHSA-old', summary: 'old', published: '2020-01-01T00:00:00Z', affected: [{ package: { name: 'django', ecosystem: 'PyPI' } }] },
                { id: 'GHSA-new', summary: 'new', published: '2026-01-01T00:00:00Z', affected: [{ package: { name: 'django', ecosystem: 'PyPI' } }] },
            ],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

        const rows = await cmd.func({ package: 'django', ecosystem: 'PyPI', limit: 5 });
        expect(rows[0]).toMatchObject({ rank: 1, id: 'GHSA-new', published: '2026-01-01T00:00:00Z' });
        expect(rows[1]).toMatchObject({ rank: 2, id: 'GHSA-old' });
        expect(rows[0].url).toBe('https://osv.dev/vulnerability/GHSA-new');
    });
});
