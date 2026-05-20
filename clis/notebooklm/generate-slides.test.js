import { describe, expect, it } from 'vitest';
import { __test__ } from './generate-slides.js';

const { SLIDE_DECK_CONFIG_BLOCK, buildCreateSlidesArgs, parseSlidesIdFromResult } = __test__;

describe('notebooklm generate-slides', () => {
    it('SLIDE_DECK_CONFIG_BLOCK reuses the same R7cb6c config envelope as audio', () => {
        expect(SLIDE_DECK_CONFIG_BLOCK).toEqual([
            2, null, null,
            [1, null, null, null, null, null, null, null, null, null, [1]],
            [[1, 4, 2, 3, 6]],
        ]);
    });

    it('buildCreateSlidesArgs matches the live-captured slide-deck wire format', () => {
        const projectId = '17e2b882-6a01-4c6c-9262-0738dfa2abee';
        const sourceA = '493b9ddd-453b-4523-b638-bb560b37723c';
        const sourceB = '182508cf-9afd-4db5-8640-2f8cafcc7111';
        expect(buildCreateSlidesArgs(projectId, [sourceA, sourceB])).toEqual([
            [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 2, 3, 6]]],
            projectId,
            [
                null, null, 8,
                [[[sourceA]], [[sourceB]]],
                null, null,
                null, null, null, null, null, null, null, null, null, null,
                [[null, 'en', 1, 3]],
            ],
        ]);
    });

    it('buildCreateSlidesArgs honours --language and --length overrides', () => {
        const args = buildCreateSlidesArgs('pid', ['s1'], { language: 'zh', length: 1 });
        expect(args[2][16]).toEqual([[null, 'zh', 1, 1]]);
    });

    it('parseSlidesIdFromResult finds a UUID-shaped slides id anywhere in the tree', () => {
        const id = '1f8ada7d-cb33-49a4-8498-c5b81c1a899d';
        expect(parseSlidesIdFromResult([[id, 'opencli-slides-test']])).toBe(id);
        expect(parseSlidesIdFromResult({ artifactId: id })).toBe(id);
    });

    it('parseSlidesIdFromResult ignores non-UUID strings and empty inputs', () => {
        expect(parseSlidesIdFromResult([[null, 'opencli-slides-test']])).toBe('');
        expect(parseSlidesIdFromResult({})).toBe('');
        expect(parseSlidesIdFromResult([])).toBe('');
        expect(parseSlidesIdFromResult(null)).toBe('');
    });
});
