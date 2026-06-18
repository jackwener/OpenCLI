import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './item.js';
import './wayback.js';
import './snapshots.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('archive adapter registry contracts', () => {
    it('declares archive search columns so identifier round-trips into archive item', () => {
        const search = getRegistry().get('archive/search');
        const item = getRegistry().get('archive/item');

        expect(search).toBeDefined();
        expect(item).toBeDefined();
        expect(search.columns).toEqual(['rank', 'identifier', 'title', 'creator', 'date', 'mediatype', 'downloads', 'url']);
        expect(item.columns).toContain('identifier');
    });

    it('declares wayback and snapshots columns so URL round-trips between them', () => {
        const wayback = getRegistry().get('archive/wayback');
        const snapshots = getRegistry().get('archive/snapshots');

        expect(wayback).toBeDefined();
        expect(snapshots).toBeDefined();
        expect(wayback.columns).toContain('snapshot_url');
        expect(snapshots.columns).toContain('snapshot_url');
        expect(wayback.columns).toContain('original_url');
        expect(snapshots.columns).toContain('original_url');
    });

    it('marks every archive command as read access on the archive.org domain', () => {
        for (const name of ['search', 'item', 'wayback', 'snapshots']) {
            const cmd = getRegistry().get(`archive/${name}`);
            expect(cmd, name).toBeDefined();
            expect(cmd.access, name).toBe('read');
            expect(cmd.domain, name).toBe('archive.org');
            expect(cmd.browser, name).toBe(false);
        }
    });
});

describe('archive search command', () => {
    const command = getRegistry().get('archive/search');

    it('returns stable identifier rows that round-trip to archive item', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            response: {
                docs: [{
                    identifier: 'sample_item-1',
                    title: 'Sample Item',
                    creator: ['Alice', 'Bob'],
                    date: '2020-01-02T00:00:00Z',
                    mediatype: 'texts',
                    downloads: '42',
                }],
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: 'sample', limit: 1 })).resolves.toEqual([{
            rank: 1,
            identifier: 'sample_item-1',
            title: 'Sample Item',
            creator: 'Alice, Bob',
            date: '2020-01-02',
            mediatype: 'texts',
            downloads: 42,
            url: 'https://archive.org/details/sample_item-1',
        }]);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get('q')).toBe('sample');
        expect(url.searchParams.getAll('fl[]')).toContain('identifier');
    });

    it('rejects invalid arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: ' ', limit: 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', mediatype: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', sort: 'bad' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps true empty search results to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ response: { docs: [] } })));

        await expect(command.func({ query: 'zz-no-hit', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails malformed search payloads instead of emitting empty identifiers', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ response: { docs: [{ title: 'No id' }] } })));

        await expect(command.func({ query: 'bad', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('archive item command', () => {
    const command = getRegistry().get('archive/item');

    it('returns metadata for the requested stable identifier', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            metadata: {
                identifier: 'sample_item-1',
                title: 'Sample Item',
                creator: 'Alice',
                date: '2020',
                mediatype: 'texts',
                collection: ['opensource'],
                description: ['Line one.', 'Line two.'],
            },
            files: [{ name: 'a.txt' }, { name: 'b.txt' }],
        })));

        await expect(command.func({ identifier: 'sample_item-1' })).resolves.toEqual([{
            identifier: 'sample_item-1',
            title: 'Sample Item',
            creator: 'Alice',
            date: '2020',
            mediatype: 'texts',
            collection: 'opensource',
            description: 'Line one. Line two.',
            file_count: 2,
            url: 'https://archive.org/details/sample_item-1',
        }]);
    });

    it('rejects invalid identifiers before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ identifier: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ identifier: '../secret' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps missing public metadata to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));

        await expect(command.func({ identifier: 'missing_item' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails mismatched identity and malformed files payload', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ metadata: { identifier: 'other_item' }, files: [] }))
            .mockResolvedValueOnce(jsonResponse({ metadata: { identifier: 'sample_item' }, files: {} })));

        await expect(command.func({ identifier: 'sample_item' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ identifier: 'sample_item' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('archive wayback command', () => {
    const command = getRegistry().get('archive/wayback');

    it('returns the closest snapshot with normalized timestamp input', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            url: 'example.com',
            archived_snapshots: {
                closest: {
                    available: true,
                    timestamp: '20200102030405',
                    url: 'https://web.archive.org/web/20200102030405/https://example.com/',
                    status: '200',
                },
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ url: 'example.com', timestamp: '2020-01-02T03:04:05' })).resolves.toEqual([{
            original_url: 'example.com',
            requested_timestamp: '20200102030405',
            snapshot_timestamp: '20200102030405',
            snapshot_url: 'https://web.archive.org/web/20200102030405/https://example.com/',
            status: '200',
        }]);
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('timestamp')).toBe('20200102030405');
    });

    it('rejects invalid URL/timestamp arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ url: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ url: 'example.com', timestamp: '202' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('distinguishes no snapshot from malformed closest snapshot', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({ archived_snapshots: {} }))
            .mockResolvedValueOnce(jsonResponse({ archived_snapshots: { closest: { available: true, url: 'x' } } })));

        await expect(command.func({ url: 'example.com' })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(command.func({ url: 'example.com' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('archive snapshots command', () => {
    const command = getRegistry().get('archive/snapshots');

    it('returns CDX snapshots with stable Wayback permalinks', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
            ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode'],
            ['com,example)/', '20200102030405', 'https://example.com/', 'text/html', '200'],
        ]));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ url: 'example.com', from: '2020', limit: 1 })).resolves.toEqual([{
            timestamp: '20200102030405',
            snapshot_url: 'https://web.archive.org/web/20200102030405/https://example.com/',
            status: '200',
            mimetype: 'text/html',
            original_url: 'https://example.com/',
        }]);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.protocol).toBe('http:');
        expect(url.searchParams.get('from')).toBe('2020');
    });

    it('rejects invalid arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ url: '', limit: 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ url: 'example.com', limit: 1001 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ url: 'example.com', from: '2020-01' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps no CDX rows to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([['timestamp', 'original', 'statuscode', 'mimetype']])));

        await expect(command.func({ url: 'missing.example', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails malformed CDX headers and rows', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse([['timestamp', 'original'], ['20200102030405', 'https://example.com/']]))
            .mockResolvedValueOnce(jsonResponse([['timestamp', 'original', 'statuscode', 'mimetype'], ['', 'https://example.com/', '200', 'text/html']]))
            .mockResolvedValueOnce(jsonResponse({ timestamp: '20200102030405' }))
            .mockResolvedValueOnce(jsonResponse([['timestamp', 'original', 'statuscode', 'mimetype'], ['20200102030405', 'https://example.com/']])));

        await expect(command.func({ url: 'example.com', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ url: 'example.com', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ url: 'example.com', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ url: 'example.com', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
