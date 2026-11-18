import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './channel-videos.js';
import { extractSelectedRichGridContents, parseVideoItem } from './channel-helpers.js';

const { normalizeChannelInput, collectVideosFromBrowse } = __test__;

function lockup(id, title = `Video ${id}`) {
    return {
        richItemRenderer: {
            content: {
                lockupViewModel: {
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    contentId: id,
                    metadata: {
                        lockupMetadataViewModel: {
                            title: { content: title },
                            metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '12K views' } }, { text: { content: '3 days ago' } }] }] } },
                        },
                    },
                    contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '10:00' } }] } }] } },
                },
            },
        },
    };
}

function browsePayload(items) {
    return { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: items } } } }] } } };
}

describe('youtube channel-videos', () => {
    it('normalizes channel references', () => {
        expect(normalizeChannelInput('@veritasium')).toBe('@veritasium');
        expect(normalizeChannelInput('veritasium')).toBe('@veritasium');
        expect(normalizeChannelInput('UCHnyfMqiRRG1u-2MsSQLbXA')).toBe('UCHnyfMqiRRG1u-2MsSQLbXA');
        expect(normalizeChannelInput('https://www.youtube.com/@veritasium/videos')).toBe('@veritasium');
        expect(normalizeChannelInput('https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA')).toBe('UCHnyfMqiRRG1u-2MsSQLbXA');
        expect(() => normalizeChannelInput('')).toThrow(ArgumentError);
        expect(() => normalizeChannelInput('not a channel ref!!')).toThrow(ArgumentError);
    });

    it('collects videos plus the continuation token from grid and continuation payloads', () => {
        const grid = browsePayload([lockup('a'), lockup('b'), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'tok' } } } }]);
        const first = collectVideosFromBrowse(grid, parseVideoItem, extractSelectedRichGridContents);
        expect(first.videos.map((v) => v.video_id)).toEqual(['a', 'b']);
        expect(first.continuation).toBe('tok');
        const cont = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [lockup('c')] } }] };
        const second = collectVideosFromBrowse(cont, parseVideoItem, extractSelectedRichGridContents);
        expect(second.videos.map((v) => v.video_id)).toEqual(['c']);
        expect(second.continuation).toBeNull();
    });

    it('maps the evaluate payload into ranked rows with numeric views', async () => {
        const command = getRegistry().get('youtube/channel-videos');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA',
                videos: [
                    { video_id: 'a', title: 'A', duration: '10:00', views: '12K views | 3 days ago', published: '3 days ago', url: 'https://www.youtube.com/watch?v=a' },
                    { video_id: 'b', title: 'B', duration: '1:00', views: '1.2M views | 1 year ago', published: '1 year ago', url: 'https://www.youtube.com/watch?v=b' },
                ],
            }),
        };
        const rows = await command.func(page, { id: '@veritasium', limit: 2 });
        expect(rows).toEqual([
            { rank: 1, video_id: 'a', title: 'A', duration: '10:00', views: '12K views | 3 days ago', views_count: 12000, published: '3 days ago', url: 'https://www.youtube.com/watch?v=a', channel_id: 'UCHnyfMqiRRG1u-2MsSQLbXA' },
            { rank: 2, video_id: 'b', title: 'B', duration: '1:00', views: '1.2M views | 1 year ago', views_count: 1200000, published: '1 year ago', url: 'https://www.youtube.com/watch?v=b', channel_id: 'UCHnyfMqiRRG1u-2MsSQLbXA' },
        ]);
        expect(Object.keys(rows[0]).sort()).toEqual([...command.columns].sort());
        expect(String(page.evaluate.mock.calls[0][0])).toContain(JSON.stringify('@veritasium'));
    });

    it('maps errors and empty channels', async () => {
        const command = getRegistry().get('youtube/channel-videos');
        const make = (value) => ({ goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn().mockResolvedValue(value) });
        await expect(command.func(make({ error: 'YouTube config not found' }), { id: '@x', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(make({ channelId: 'UC1', videos: [] }), { id: '@x', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(command.func(make(null), { id: '@x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    });
});
