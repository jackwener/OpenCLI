import { describe, expect, it } from 'vitest';
import { __test__ } from './ask.js';

describe('qwen ask helpers', () => {
    describe('getBaselineChatAnchor', () => {
        // getMessageBubbles drives a page.evaluate that returns the raw bubble
        // array; in tests we route page.evaluate straight to an in-memory array.
        const fakePage = (bubbles) => ({ evaluate: () => Promise.resolve(bubbles) });

        it('returns the last visible bubble and most recent Assistant bubble', async () => {
            const bubbles = [
                { id: 'a1', role: 'Assistant', text: 'first answer', html: '' },
                { id: 'u1', role: 'User', text: 'follow-up', html: '' },
                { id: 'a2', role: 'Assistant', text: 'second answer', html: '' },
                { id: 'u2', role: 'User', text: 'newest user turn', html: '' },
            ];
            expect(await __test__.getBaselineChatAnchor(fakePage(bubbles))).toEqual({
                lastBubbleId: 'u2',
                lastAssistantId: 'a2',
            });
        });

        it('returns empty assistant id when no Assistant bubble exists yet (fresh chat)', async () => {
            expect(await __test__.getBaselineChatAnchor(fakePage([]))).toEqual({
                lastBubbleId: '',
                lastAssistantId: '',
            });
            expect(await __test__.getBaselineChatAnchor(fakePage([
                { id: 'u1', role: 'User', text: 'hello', html: '' },
            ]))).toEqual({
                lastBubbleId: 'u1',
                lastAssistantId: '',
            });
        });
    });
});
