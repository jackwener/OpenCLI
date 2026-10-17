import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './search.js';
import './show.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('tvmaze search adapter', () => {
    const cmd = getRegistry().get('tvmaze/search');

    it('strips HTML from summary and ids round-trip into tvmaze show <id>', async () => {
        const list = [{
            score: 1.2,
            show: {
                id: 169, name: 'Breaking Bad', type: 'Scripted', language: 'English',
                genres: ['Drama'], status: 'Ended', premiered: '2008-01-20', ended: '2019-10-11',
                network: { name: 'AMC' }, rating: { average: 9.2 },
                summary: '<p><b>Breaking Bad</b> is a show with &amp; entities &#39;here&#39;, &#x27;hex&#x27;, and &hellip;.</p>',
                url: 'https://www.tvmaze.com/shows/169/breaking-bad',
            },
        }];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(list), { status: 200 })));

        const rows = await cmd.func({ query: 'breaking bad', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 169, name: 'Breaking Bad', network: 'AMC', rating: 9.2, matchScore: 1.2,
        });
        expect(rows[0].summary).toBe("Breaking Bad is a show with & entities 'here', 'hex', and ….");
        // id round-trip
        expect(typeof rows[0].id).toBe('number');
    });
});
