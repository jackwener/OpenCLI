import { describe, expect, it } from 'vitest';
import { __test__ } from './ask.js';

describe('grok ask helpers', () => {
    describe('getBaselineLastAssistantId', () => {
        const fakePage = (bubbles) => ({
            // getMessageBubbles in utils.js drives a page.evaluate; in tests we
            // route directly to the in-memory bubble array.
            evaluate: () => Promise.resolve(bubbles),
        });

        it('returns the id of the most recent Assistant bubble, ignoring later User turns', async () => {
            const bubbles = [
                { id: 'a1', role: 'Assistant', text: 'first answer', html: '' },
                { id: 'u1', role: 'User', text: 'follow-up', html: '' },
                { id: 'a2', role: 'Assistant', text: 'second answer', html: '' },
                { id: 'u2', role: 'User', text: 'newest user turn', html: '' },
            ];
            expect(await __test__.getBaselineLastAssistantId(fakePage(bubbles))).toBe('a2');
        });

        it('returns empty string when no Assistant bubble exists yet (fresh chat)', async () => {
            expect(await __test__.getBaselineLastAssistantId(fakePage([]))).toBe('');
            expect(await __test__.getBaselineLastAssistantId(fakePage([
                { id: 'u1', role: 'User', text: 'hello', html: '' },
            ]))).toBe('');
        });
    });
});
