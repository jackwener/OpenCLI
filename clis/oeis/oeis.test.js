import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './search.js';
import './sequence.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('oeis search adapter', () => {
    const cmd = getRegistry().get('oeis/search');

    it('round-trips A-id from search row into oeis.org URL', async () => {
        const result = [{
            number: 45, name: 'Fibonacci numbers', keyword: 'core,nonn,nice',
            data: '0,1,1,2,3,5,8,13,21,34,55,89',
            author: 'Sloane', created: '1991-04-30T03:00:00-04:00',
        }];
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))));
        const rows = await cmd.func({ query: 'fibonacci', limit: 1 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'A000045', name: 'Fibonacci numbers',
            keywords: 'core,nonn,nice',
            preview: '0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89',
            url: 'https://oeis.org/A000045',
        });
    });
});
