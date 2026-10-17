import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './paper.js';
import './citations.js';
import './recommendations.js';
import './search.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
});

describe('semanticscholar search command', () => {
    const command = getRegistry().get('semanticscholar/search');

    it('returns search rows that round-trip into semanticscholar paper', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            data: [{
                paperId: 'sp1',
                title: 'A Search Hit',
                year: 2023,
                authors: [{ name: 'Dana' }],
                citationCount: 99,
                externalIds: { DOI: '10.1/sp1' },
            }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: 'transformers', limit: 1 })).resolves.toEqual([{
            rank: 1,
            paperId: 'sp1',
            doi: '10.1/sp1',
            title: 'A Search Hit',
            year: 2023,
            firstAuthor: 'Dana',
            citationCount: 99,
            url: 'https://www.semanticscholar.org/paper/sp1',
        }]);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get('query')).toBe('transformers');
    });

});
