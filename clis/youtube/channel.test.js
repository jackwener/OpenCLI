import { describe, expect, it } from 'vitest';
import { __test__ } from './channel.js';

function tab(title, contents, selected = false) {
    return {
        tabRenderer: {
            title,
            selected,
            content: {
                richGridRenderer: {
                    contents,
                },
            },
        },
    };
}

function browseData(tabs) {
    return {
        contents: {
            twoColumnBrowseResultsRenderer: {
                tabs,
            },
        },
    };
}

describe('youtube channel helpers', () => {
    it('uses the selected rich-grid tab instead of the first tab', () => {
        const home = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'home' } } } }];
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'videos' } } } }];

        expect(__test__.extractSelectedRichGridContents(browseData([
            tab('Home', home),
            tab('Videos', videos, true),
        ]))).toBe(videos);
    });

    it('falls back to the first non-empty rich-grid tab when no tab is selected', () => {
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'only' } } } }];

        expect(__test__.extractSelectedRichGridContents(browseData([
            tab('Home', []),
            tab('Videos', videos),
        ]))).toBe(videos);
    });

    it('is self-contained for browser evaluate injection', () => {
        const extractSelectedRichGridContents = Function(
            `return ${__test__.extractSelectedRichGridContents.toString()}`
        )();
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'serialized' } } } }];

        expect(extractSelectedRichGridContents(browseData([
            tab('Home', []),
            tab('Videos', videos, true),
        ]))).toEqual(videos);
    });
});
