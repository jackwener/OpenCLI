import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

describe('semanticscholar adapter registry contracts', () => {
    it('declares paper columns so paperId round-trips into citations and recommendations', () => {
        const paper = getRegistry().get('semanticscholar/paper');
        const citations = getRegistry().get('semanticscholar/citations');
        const recommendations = getRegistry().get('semanticscholar/recommendations');

        expect(paper).toBeDefined();
        expect(citations).toBeDefined();
        expect(recommendations).toBeDefined();
        expect(paper.columns).toContain('paperId');
        expect(citations.columns).toContain('paperId');
        expect(recommendations.columns).toContain('paperId');
    });

    it('surfaces the unique Semantic Scholar fields on paper detail', () => {
        const paper = getRegistry().get('semanticscholar/paper');

        expect(paper.columns).toContain('influentialCitationCount');
        expect(paper.columns).toContain('tldr');
    });

    it('marks every command as read access on the api.semanticscholar.org domain', () => {
        for (const name of ['paper', 'citations', 'recommendations', 'search']) {
            const cmd = getRegistry().get(`semanticscholar/${name}`);
            expect(cmd, name).toBeDefined();
            expect(cmd.access, name).toBe('read');
            expect(cmd.domain, name).toBe('api.semanticscholar.org');
            expect(cmd.browser, name).toBe(false);
        }
    });
});

describe('semanticscholar paper command', () => {
    const command = getRegistry().get('semanticscholar/paper');

    it('returns the paper row with citation graph and tldr', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            paperId: 'df2b0e26d0599ce3e70df8a9da02e51594e0e992',
            title: 'BERT: Pre-training of Deep Bidirectional Transformers',
            year: 2019,
            authors: [{ name: 'Jacob Devlin' }, { name: 'Ming-Wei Chang' }],
            citationCount: 116233,
            influentialCitationCount: 22448,
            referenceCount: 63,
            tldr: { text: 'A new language representation model called BERT.' },
            externalIds: { DOI: '10.18653/v1/N19-1423' },
            url: 'https://www.semanticscholar.org/paper/df2b0e26d0599ce3e70df8a9da02e51594e0e992',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ id: '10.18653/v1/N19-1423' })).resolves.toEqual([{
            paperId: 'df2b0e26d0599ce3e70df8a9da02e51594e0e992',
            doi: '10.18653/v1/N19-1423',
            title: 'BERT: Pre-training of Deep Bidirectional Transformers',
            year: 2019,
            firstAuthor: 'Jacob Devlin',
            citationCount: 116233,
            influentialCitationCount: 22448,
            referenceCount: 63,
            tldr: 'A new language representation model called BERT.',
            url: 'https://www.semanticscholar.org/paper/df2b0e26d0599ce3e70df8a9da02e51594e0e992',
        }]);
        // DOI normalization: bare 10.x DOIs get the DOI: prefix encoded into the path.
        expect(fetchMock.mock.calls[0][0]).toContain('DOI%3A10.18653%2Fv1%2FN19-1423');
    });

    it('forwards SEMANTIC_SCHOLAR_API_KEY as the x-api-key header when set', async () => {
        process.env.SEMANTIC_SCHOLAR_API_KEY = 'test-key';
        const paperId = 'a'.repeat(40);
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ paperId, title: 'x' }));
        vi.stubGlobal('fetch', fetchMock);

        await command.func({ id: paperId });
        expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('test-key');
    });

    it('rejects invalid identifiers before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ id: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: 'not a real reference' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('typed-fails malformed paper detail rows instead of treating parser drift as empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));

        await expect(command.func({ id: '10.0/missing' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails non-numeric metric fields instead of returning NaN', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            paperId: 'df2b0e26d0599ce3e70df8a9da02e51594e0e992',
            title: 'Bad Metrics',
            citationCount: 'many',
        })));

        await expect(command.func({ id: '10.0/bad-metrics' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('semanticscholar citations command', () => {
    const command = getRegistry().get('semanticscholar/citations');

    it('unwraps citingPaper rows and offsets ranks correctly', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            data: [
                { citingPaper: { paperId: 'p1', title: 'Citing One', year: 2024, authors: [{ name: 'Alice' }], citationCount: 5, externalIds: { DOI: '10.1/p1' } } },
                { citingPaper: { paperId: 'p2', title: 'Citing Two', year: 2025, authors: [{ name: 'Bob' }], citationCount: 12, externalIds: {} } },
            ],
        })));

        await expect(command.func({ id: '10.18653/v1/N19-1423', limit: 2, offset: 10 })).resolves.toEqual([
            { rank: 11, paperId: 'p1', doi: '10.1/p1', title: 'Citing One', year: 2024, firstAuthor: 'Alice', citationCount: 5, url: 'https://www.semanticscholar.org/paper/p1' },
            { rank: 12, paperId: 'p2', doi: '', title: 'Citing Two', year: 2025, firstAuthor: 'Bob', citationCount: 12, url: 'https://www.semanticscholar.org/paper/p2' },
        ]);
    });

    it('rejects invalid arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ id: '', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '10.0/x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '10.0/x', limit: 1001 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps empty citation pages to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails malformed payloads instead of returning empty rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails malformed citation rows without a citing paper identity', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            data: [{ citingPaper: { title: 'Missing identity' } }],
        })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails citation entries missing citingPaper instead of emitting blank rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            data: [{ contexts: ['missing citing paper'] }],
        })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('semanticscholar recommendations command', () => {
    const command = getRegistry().get('semanticscholar/recommendations');

    it('returns recommendedPapers rows ranked from 1', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            recommendedPapers: [
                { paperId: 'r1', title: 'Related One', year: 2024, authors: [{ name: 'Carol' }], citationCount: 7, externalIds: { DOI: '10.1/r1' } },
            ],
        })));

        await expect(command.func({ id: '10.18653/v1/N19-1423', limit: 1 })).resolves.toEqual([
            { rank: 1, paperId: 'r1', doi: '10.1/r1', title: 'Related One', year: 2024, firstAuthor: 'Carol', citationCount: 7, url: 'https://www.semanticscholar.org/paper/r1' },
        ]);
    });

    it('maps empty recommendation responses to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ recommendedPapers: [] })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails when the payload is missing recommendedPapers entirely', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails malformed recommendation rows without a stable paper identity', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            recommendedPapers: [{ title: 'Missing id' }],
        })));

        await expect(command.func({ id: '10.0/x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
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

    it('rejects invalid arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: ' ', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('retries once on 429 when no API key is configured', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
            .mockResolvedValueOnce(jsonResponse({ data: [{ paperId: 'after', title: 'Recovered', year: 2024, authors: [], citationCount: 0, externalIds: {} }] }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await command.func({ query: 'bursty', limit: 1 });
        expect(rows[0].paperId).toBe('after');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('maps empty search results to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));

        await expect(command.func({ query: 'zz-no-hit', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails malformed search rows without a stable paper identity', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            data: [{ title: 'Missing id' }],
        })));

        await expect(command.func({ query: 'broken row', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
