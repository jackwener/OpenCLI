import { describe, expect, it } from 'vitest';
import { parseTextExtra, extractHashtagNames } from './text-extra.js';
describe('parseTextExtra', () => {
    it('returns empty array for text with no hashtags', () => {
        const result = parseTextExtra('普通文本内容', []);
        expect(result).toEqual([]);
    });
    it('produces type-1 entry for each hashtag', () => {
        const hashtags = [
            { name: '话题', id: 12345, start: 5, end: 8 },
        ];
        const result = parseTextExtra('普通文本 #话题', hashtags);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 1,
            hashtag_name: '话题',
            hashtag_id: 12345,
            start: 5,
            end: 8,
        });
    });
    it('sets hashtag_id to 0 when not found', () => {
        const hashtags = [
            { name: '未知话题', id: 0, start: 0, end: 5 },
        ];
        const result = parseTextExtra('#未知话题', hashtags);
        expect(result[0].hashtag_id).toBe(0);
    });
});
describe('extractHashtagNames', () => {
    it('extracts hashtag names from text', () => {
        expect(extractHashtagNames('hello #foo and #bar')).toEqual(['foo', 'bar']);
    });
    it('returns empty array when no hashtags', () => {
        expect(extractHashtagNames('no hashtags here')).toEqual([]);
    });
});
