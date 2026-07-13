import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './detail.js';
import { createPageMock } from '../test-utils.js';

function makeFetchResult(overrides = {}) {
    return {
        ok: true,
        shortcode: 'DZZfMsvuxgD',
        owner: 'devtalksbusiness',
        media: {
            id: '3916298563096352771',
            shortcode: 'DZZfMsvuxgD',
            product_type: 'clips',
            is_video: true,
            taken_at_timestamp: 1781079284,
            video_view_count: 10266,
            video_play_count: 34960,
            video_url: 'https://cdn.example.com/main.mp4',
            display_url: 'https://cdn.example.com/thumb.jpg',
            edge_media_preview_like: { count: 895 },
            edge_media_to_comment: { count: 22 },
            edge_media_to_caption: {
                edges: [{ node: { text: 'Caption line 1\n\n#tag' } }],
            },
            owner: {
                username: 'devtalksbusiness',
                full_name: 'Dev Taneja',
                is_verified: true,
            },
        },
        items: [{ type: 'video', url: 'https://cdn.example.com/main.mp4' }],
        ...overrides,
    };
}

describe('instagram detail command', () => {
    it('registers canonical columns for single-post detail', () => {
        const cmd = getRegistry().get('instagram/detail');
        expect(cmd).toBeDefined();
        expect(cmd?.columns).toContain('media_urls');
        expect(cmd?.columns).toContain('thumbnail_url');
        expect(cmd?.columns).toContain('posted_at');
        expect(cmd?.columns).toContain('owner_verified');
    });

    it('returns one normalized reel row with direct media URL', async () => {
        const page = createPageMock([makeFetchResult()]);
        const cmd = getRegistry().get('instagram/detail');
        const rows = await cmd.func(page, { url: 'https://www.instagram.com/reel/DZZfMsvuxgD/' });
        expect(page.goto).toHaveBeenCalledWith('https://www.instagram.com/reel/DZZfMsvuxgD/');
        expect(rows).toEqual([{
            shortcode: 'DZZfMsvuxgD',
            media_id: '3916298563096352771',
            kind: 'reel',
            type: 'video',
            posted_at: '2026-06-10T08:14:44.000Z',
            owner: 'devtalksbusiness',
            owner_name: 'Dev Taneja',
            owner_verified: 'Yes',
            caption: 'Caption line 1 #tag',
            likes: 895,
            comments: 22,
            views: 10266,
            media_count: 1,
            media_types: 'video',
            media_urls: 'https://cdn.example.com/main.mp4',
            thumbnail_url: 'https://cdn.example.com/thumb.jpg',
            url: 'https://www.instagram.com/reel/DZZfMsvuxgD/',
        }]);
    });

    it('returns carousel children as newline-separated direct URLs', async () => {
        const page = createPageMock([makeFetchResult({
            media: {
                id: '3915686063774450776',
                shortcode: 'DZXT7qTOURY',
                product_type: 'feed',
                is_video: false,
                taken_at_timestamp: 1781006305,
                display_url: 'https://cdn.example.com/carousel-cover.jpg',
                edge_media_preview_like: { count: 3226 },
                edge_media_to_parent_comment: { count: 1783 },
                edge_media_to_caption: {
                    edges: [{ node: { text: 'Carousel caption' } }],
                },
                owner: {
                    username: 'devtalksbusiness',
                    full_name: 'Dev Taneja',
                    is_verified: true,
                },
                edge_sidecar_to_children: {
                    edges: [
                        { node: { is_video: false, display_url: 'https://cdn.example.com/carousel-1.jpg' } },
                        { node: { is_video: true, video_url: 'https://cdn.example.com/carousel-2.mp4' } },
                    ],
                },
            },
        })]);
        const cmd = getRegistry().get('instagram/detail');
        const rows = await cmd.func(page, { url: 'https://www.instagram.com/p/DZXT7qTOURY/' });
        expect(rows[0]).toMatchObject({
            kind: 'p',
            type: 'carousel',
            media_count: 2,
            media_types: 'image, video',
            media_urls: 'https://cdn.example.com/carousel-1.jpg\nhttps://cdn.example.com/carousel-2.mp4',
            comments: 1783,
            url: 'https://www.instagram.com/p/DZXT7qTOURY/',
        });
    });

    it('rejects malformed or non-instagram URLs before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/detail');
        await expect(cmd.func(page, { url: 'https://example.com/not-instagram' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { url: 'https://www.instagram.com/devtalksbusiness/' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('surfaces auth and rate-limit failures from the fetch path', async () => {
        const cmd = getRegistry().get('instagram/detail');
        await expect(cmd.func(createPageMock([{ ok: false, errorCode: 'AUTH_REQUIRED', error: 'login required' }]), {
            url: 'https://www.instagram.com/reel/DZZfMsvuxgD/',
        })).rejects.toThrow(AuthRequiredError);
        await expect(cmd.func(createPageMock([{ ok: false, errorCode: 'RATE_LIMITED', error: 'slow down' }]), {
            url: 'https://www.instagram.com/reel/DZZfMsvuxgD/',
        })).rejects.toThrow(CliError);
    });

    it('throws when detail payload is missing required fields', async () => {
        const page = createPageMock([makeFetchResult({ media: { shortcode: '', owner: {} } })]);
        const cmd = getRegistry().get('instagram/detail');
        await expect(cmd.func(page, { url: 'https://www.instagram.com/reel/DZZfMsvuxgD/' })).rejects.toThrow(CommandExecutionError);
    });
});
