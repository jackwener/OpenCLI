import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './search.js';
import './entity.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('wikidata search adapter', () => {
    const cmd = getRegistry().get('wikidata/search');

    it('round-trips Q-id from search row into wikidata.org URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            search: [{ id: 'Q937', label: 'Albert Einstein', description: 'physicist', match: { type: 'alias', text: 'Einstein' } }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'einstein', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, qid: 'Q937', label: 'Albert Einstein', matchType: 'alias',
            url: 'https://www.wikidata.org/wiki/Q937',
        });
    });
});
