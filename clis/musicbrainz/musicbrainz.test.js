import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './artist.js';
import './release.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('musicbrainz artist adapter', () => {
    const cmd = getRegistry().get('musicbrainz/artist');

    it('rejects empty / oversized queries before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 503 (typical anonymous throttle) to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('throttled', { status: 503 })));
        await expect(cmd.func({ query: 'whatever', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty artist list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ artists: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'no-matches', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips MBID into /artist/<mbid> URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            artists: [{
                id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
                name: 'Radiohead',
                'sort-name': 'Radiohead',
                type: 'Group',
                country: 'GB',
                'life-span': { begin: '1991', ended: false },
                score: 100,
            }],
        }), { status: 200 })));

        const rows = await cmd.func({ query: 'radiohead', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1,
            mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
            name: 'Radiohead',
            ended: null,
            url: 'https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711',
        });
    });
});

describe('musicbrainz release adapter', () => {
    const cmd = getRegistry().get('musicbrainz/release');

    it('rejects malformed MBID before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ mbid: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ mbid: 'not-a-uuid' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ mbid: '76df3287-6cda-33eb-8e9a-044b5e15ffd' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ mbid: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(EmptyResultError);
    });

    it('joins artist credits with joinphrase and surfaces release-event country code', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: '76df3287-6cda-33eb-8e9a-044b5e15ffdd',
            title: 'Dummy',
            status: 'Official',
            'artist-credit': [
                { name: 'Portishead', joinphrase: ' & ', artist: { name: 'Portishead' } },
                { name: 'Beth Gibbons', joinphrase: '', artist: { name: 'Beth Gibbons' } },
            ],
            'release-events': [{ date: '1994-08-22', area: { 'iso-3166-1-codes': ['GB'] } }],
            'release-group': { title: 'Dummy', 'primary-type': 'Album', 'first-release-date': '1994-08-22' },
            'label-info': [{ label: { name: 'Go! Beat' }, 'catalog-number': '828 553-2' }],
            'text-representation': { language: 'eng', script: 'Latn' },
        }), { status: 200 })));

        const rows = await cmd.func({ mbid: '76df3287-6cda-33eb-8e9a-044b5e15ffdd' });
        expect(rows[0]).toMatchObject({
            mbid: '76df3287-6cda-33eb-8e9a-044b5e15ffdd',
            title: 'Dummy',
            artistCredit: 'Portishead & Beth Gibbons',
            releaseCountry: 'GB',
            label: 'Go! Beat',
            url: 'https://musicbrainz.org/release/76df3287-6cda-33eb-8e9a-044b5e15ffdd',
        });
    });
});
