import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { exploreCommand, __test__ } from './explore.js';

const { collectExploreMedia, buildExploreFetchScript } = __test__;

function mk(pk, extra = {}) {
    return { pk, user: { username: 'u' + pk }, caption: { text: 'c' + pk }, ...extra };
}

describe('instagram explore extraction (#2091)', () => {
    it('collects media from the new nested layout shapes (clips/fill_items)', () => {
        const data = {
            sectional_items: [
                { one_by_two_item: { clips: { items: [{ media: mk('1', { media_type: 2, play_count: 500 }) }] } } },
                { fill_items: [{ media: mk('2', { media_type: 1, like_count: 10, comment_count: 3 }) }] },
            ],
        };
        expect(collectExploreMedia(data, 20)).toEqual([
            { rank: 1, user: 'u1', caption: 'c1', likes: 500, comments: 0, type: 'video' },
            { rank: 2, user: 'u2', caption: 'c2', likes: 10, comments: 3, type: 'photo' },
        ]);
    });

    it('still reads the legacy flat layout_content.medias[] path', () => {
        const data = { sectional_items: [{ layout_content: { medias: [{ media: mk('9', { media_type: 8 }) }] } }] };
        expect(collectExploreMedia(data, 20)).toEqual([
            { rank: 1, user: 'u9', caption: 'c9', likes: 0, comments: 0, type: 'carousel' },
        ]);
    });

    it('dedupes the same media by pk/id/code and respects limit', () => {
        const shared = mk('5');
        const data = { sectional_items: [{ a: { media: shared } }, { b: { media: shared } }, { c: { media: mk('6') } }] };
        const rows = collectExploreMedia(data, 1);
        expect(rows).toHaveLength(1);
        expect(rows[0].rank).toBe(1);
    });

    it('falls back to play_count for likes when like_count is absent', () => {
        const data = { sectional_items: [{ x: { media: mk('7', { play_count: 999 }) } }] };
        expect(collectExploreMedia(data, 20)[0].likes).toBe(999);
    });

    it('returns [] for empty / missing / non-object input', () => {
        expect(collectExploreMedia({}, 20)).toEqual([]);
        expect(collectExploreMedia(null, 20)).toEqual([]);
        expect(collectExploreMedia({ sectional_items: [] }, 20)).toEqual([]);
    });

    it('ignores nodes whose media has no stable id', () => {
        const data = { sectional_items: [{ a: { media: { user: { username: 'x' } } } }] };
        expect(collectExploreMedia(data, 20)).toEqual([]);
    });

    it('dedupes two distinct media objects that share a stable id', () => {
        const data = {
            sectional_items: [
                { a: { media: mk('5', { like_count: 1 }) } },
                { b: { media: mk('5', { like_count: 2 }) } }, // different object, same pk
            ],
        };
        expect(collectExploreMedia(data, 20)).toHaveLength(1);
    });

    it('fetch script targets the explore_grid endpoint with the web app id', () => {
        const js = buildExploreFetchScript();
        expect(js).toContain('/api/v1/discover/web/explore_grid/');
        expect(js).toContain('936619743392459');
    });
});

describe('instagram explore command (func)', () => {
    function makePage(evalResult) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(evalResult),
        };
    }

    it('returns ranked rows from the fetched payload', async () => {
        const data = { sectional_items: [{ x: { media: mk('1', { media_type: 1 }) } }] };
        const rows = await exploreCommand.func(makePage({ ok: true, data }), { limit: 20 });
        expect(rows).toEqual([{ rank: 1, user: 'u1', caption: 'c1', likes: 0, comments: 0, type: 'photo' }]);
    });

    it('unwraps the Browser Bridge {session,data} envelope', async () => {
        const data = { sectional_items: [{ x: { media: mk('1', { media_type: 1 }) } }] };
        const rows = await exploreCommand.func(makePage({ session: 'site:instagram', data: { ok: true, data } }), { limit: 20 });
        expect(rows).toHaveLength(1);
    });

    it('throws CommandExecutionError when the in-page fetch fails', async () => {
        await expect(exploreCommand.func(makePage({ error: 'HTTP 403' }), { limit: 20 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
