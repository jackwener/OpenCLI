import { describe, expect, it, vi } from 'vitest';
import { mergeTranscriptSnapshots, navigateToConversation, parseDoubaoConversationId } from './utils.js';
describe('parseDoubaoConversationId', () => {
    it('extracts the numeric id from a full conversation URL', () => {
        expect(parseDoubaoConversationId('https://www.doubao.com/chat/1234567890123')).toBe('1234567890123');
    });
    it('keeps a raw id unchanged', () => {
        expect(parseDoubaoConversationId('1234567890123')).toBe('1234567890123');
    });
    it('rejects partial numeric ids', () => {
        expect(() => parseDoubaoConversationId('123')).toThrowError('Invalid Doubao thread id or URL');
    });
    it('rejects non-doubao chat urls', () => {
        expect(() => parseDoubaoConversationId('https://example.com/chat/1234567890123')).toThrowError('Invalid Doubao thread id or URL');
    });
});
describe('navigateToConversation', () => {
    it('does not treat a longer current conversation id as an exact match', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue('https://www.doubao.com/chat/12345678901234'),
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
        };
        await navigateToConversation(page, '1234567890123');
        expect(page.goto).toHaveBeenCalledWith('https://www.doubao.com/chat/1234567890123', { waitUntil: 'load', settleMs: 3000 });
    });
});
describe('mergeTranscriptSnapshots', () => {
    it('extends the transcript when the next snapshot overlaps with the tail', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Bob 00:05\nHi\nAlice 00:10\nNext topic');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic');
    });
    it('does not duplicate a snapshot that is already contained in the transcript', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Bob 00:05\nHi');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi');
    });
    it('keeps both windows when a virtualized panel returns adjacent chunks without full history', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Alice 00:10\nNext topic\nBob 00:15\nAction items');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic\nBob 00:15\nAction items');
    });
});
