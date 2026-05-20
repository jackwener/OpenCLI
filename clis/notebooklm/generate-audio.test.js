import { describe, expect, it } from 'vitest';
import { __test__ } from './generate-audio.js';

const { AUDIO_OVERVIEW_CONFIG_BLOCK, buildCreateAudioArgs, parseAudioIdFromResult } = __test__;

describe('notebooklm generate-audio', () => {
    it('AUDIO_OVERVIEW_CONFIG_BLOCK matches the live-captured wire shape', () => {
        expect(AUDIO_OVERVIEW_CONFIG_BLOCK).toEqual([
            2, null, null,
            [1, null, null, null, null, null, null, null, null, null, [1]],
            [[1, 4, 2, 3, 6]],
        ]);
    });

    it('buildCreateAudioArgs matches the byte-perfect wire format captured from the UI', () => {
        const projectId = '42ad744e-477d-4198-97b6-a9ae6a663165';
        const sourceId = '7c7666bd-59e1-42ab-879d-bacfe33325eb';
        expect(buildCreateAudioArgs(projectId, [sourceId])).toEqual([
            [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 2, 3, 6]]],
            projectId,
            [null, null, 1, [[[sourceId]]], null, null, [null, [null, null, null, [[sourceId]]]]],
        ]);
    });

    it('buildCreateAudioArgs threads multiple sources into both the nested and tail blocks', () => {
        const a = '11111111-1111-4111-8111-111111111111';
        const b = '22222222-2222-4222-8222-222222222222';
        const args = buildCreateAudioArgs('pid', [a, b]);
        expect(args[2][3]).toEqual([[[a]], [[b]]]);
        expect(args[2][6][1][3]).toEqual([[a], [b]]);
    });

    it('parseAudioIdFromResult walks the tree for a UUID-shaped audio id', () => {
        const id = '38da0e55-2360-4d3e-8573-61b5a6c0c219';
        expect(parseAudioIdFromResult([[id, 'opencli-audio-benjaminliu', 1]])).toBe(id);
        expect(parseAudioIdFromResult({ result: { audioId: id } })).toBe(id);
    });

    it('parseAudioIdFromResult ignores non-UUID strings', () => {
        expect(parseAudioIdFromResult([[null, 'opencli-audio-benjaminliu', 1]])).toBe('');
        expect(parseAudioIdFromResult({})).toBe('');
        expect(parseAudioIdFromResult([])).toBe('');
        expect(parseAudioIdFromResult(null)).toBe('');
    });
});
