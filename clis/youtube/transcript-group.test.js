import { describe, it, expect } from 'vitest';
import { groupTranscriptSegments, formatGroupedTranscript } from './transcript-group.js';
describe('groupTranscriptSegments', () => {
    it('groups segments by sentence boundaries', () => {
        const segments = [
            { start: 0, text: 'Hello there.' },
            { start: 2, text: 'How are you doing today?' },
            { start: 5, text: 'I am' },
            { start: 6, text: 'doing well.' },
        ];
        const result = groupTranscriptSegments(segments);
        expect(result).toHaveLength(3);
        expect(result[0].text).toBe('Hello there.');
        expect(result[1].text).toBe('How are you doing today?');
        expect(result[2].text).toBe('I am doing well.');
    });
    it('flushes on large time gaps', () => {
        const segments = [
            { start: 0, text: 'First part' },
            { start: 2, text: 'still first' },
            { start: 25, text: 'second part after gap' },
        ];
        const result = groupTranscriptSegments(segments);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('First part still first');
        expect(result[1].text).toBe('second part after gap');
    });
    it('respects 30s max group span for unpunctuated text', () => {
        // Simulate CJK captions without punctuation
        const segments = Array.from({ length: 20 }, (_, i) => ({
            start: i * 2,
            text: `segment${i}`,
        }));
        const result = groupTranscriptSegments(segments);
        // 20 segments * 2s = 40s total, should be split into at least 2 groups
        expect(result.length).toBeGreaterThanOrEqual(2);
        // No single group should span more than ~30s
        for (const g of result) {
            const words = g.text.split(' ');
            // With 2s per segment and 30s max, each group should have at most ~16 segments
            expect(words.length).toBeLessThanOrEqual(16);
        }
    });
    it('detects speaker changes via >> markers', () => {
        const segments = [
            { start: 0, text: '>> How are you?' },
            { start: 3, text: '>> I am fine.' },
        ];
        const result = groupTranscriptSegments(segments);
        expect(result.some(g => g.speakerChange)).toBe(true);
        expect(result.some(g => g.speaker !== undefined)).toBe(true);
    });
    it('recognizes CJK sentence-ending punctuation', () => {
        const segments = [
            { start: 0, text: '你好世界。' },
            { start: 2, text: '这是测试' },
            { start: 4, text: '内容。' },
        ];
        const result = groupTranscriptSegments(segments);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('你好世界。');
        expect(result[1].text).toBe('这是测试 内容。');
    });
    it('returns empty array for empty input', () => {
        expect(groupTranscriptSegments([])).toEqual([]);
    });
});
describe('formatGroupedTranscript', () => {
    it('formats timestamps correctly', () => {
        const segments = [
            { start: 65, text: 'One minute five.', speakerChange: false },
            { start: 3661, text: 'One hour one minute.', speakerChange: false },
        ];
        const { rows } = formatGroupedTranscript(segments);
        expect(rows[0].timestamp).toBe('1:05');
        expect(rows[1].timestamp).toBe('1:01:01');
    });
    it('inserts chapter headings at correct positions', () => {
        const segments = [
            { start: 0, text: 'Intro text.', speakerChange: false },
            { start: 60, text: 'Chapter content.', speakerChange: false },
        ];
        const chapters = [{ title: 'Introduction', start: 0 }, { title: 'Main', start: 50 }];
        const { rows } = formatGroupedTranscript(segments, chapters);
        expect(rows[0].text).toBe('[Chapter] Introduction');
        expect(rows[1].text).toBe('Intro text.');
        expect(rows[2].text).toBe('[Chapter] Main');
        expect(rows[3].text).toBe('Chapter content.');
    });
    it('labels speakers', () => {
        const segments = [
            { start: 0, text: 'Hello.', speakerChange: true, speaker: 0 },
            { start: 5, text: 'Hi there.', speakerChange: true, speaker: 1 },
        ];
        const { rows } = formatGroupedTranscript(segments);
        expect(rows[0].speaker).toBe('Speaker 1');
        expect(rows[1].speaker).toBe('Speaker 2');
    });
});
