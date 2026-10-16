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

    describe('rereadFinalAnswer', () => {
        const fakePage = (url, bubbles) => {
            const visited = [];
            return {
                visited,
                evaluate: (expr) => Promise.resolve(expr === 'window.location.href' ? url : bubbles),
                goto: (target) => { visited.push(target); return Promise.resolve(); },
                wait: () => Promise.resolve(),
            };
        };

        it('reloads the conversation and returns the last assistant text in full', async () => {
            const page = fakePage('https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc', [
                { id: 'u1-user', role: 'User', text: 'question', html: '' },
                { id: 'a1-assistant', role: 'Assistant', text: 'the whole answer, not cut mid-sentence', html: '' },
            ]);
            expect(await __test__.rereadFinalAnswer(page, { id: 'a1-assistant', text: 'the whole answer' })).toBe('the whole answer, not cut mid-sentence');
            expect(page.visited).toEqual(['https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc']);
        });

        it('ignores old turns and waits for the matching answer to hydrate fully', async () => {
            const page = fakePage('https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc', []);
            const frames = ['old', 'short', 'the complete answer'];
            let reads = 0;
            page.evaluate = async (expr) => expr === 'window.location.href'
                ? 'https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc'
                : [{ id: reads === 0 ? 'old-assistant' : 'a1-assistant', role: 'Assistant', text: frames[Math.min(reads++, 2)] }];
            expect(await __test__.rereadFinalAnswer(page, { id: 'a1-assistant', text: 'the complete' })).toBe('the complete answer');
            expect(reads).toBe(5);
        });

        it('keeps the original result when navigation fails or only an old reply appears', async () => {
            const page = fakePage('https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc', [
                { id: 'old-assistant', role: 'Assistant', text: 'old answer' },
            ]);
            const target = { id: 'a1-assistant', text: 'answer' };
            expect(await __test__.rereadFinalAnswer(page, target)).toBe('');
            page.goto = async () => { throw new Error('navigation failed'); };
            expect(await __test__.rereadFinalAnswer(page, target)).toBe('');
        });

        it('never replaces the answer with a persistently shorter render', async () => {
            const page = fakePage('https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc', [
                { id: 'a1-assistant', role: 'Assistant', text: 'short' },
            ]);
            expect(await __test__.rereadFinalAnswer(page, { id: 'a1-assistant', text: 'the complete answer' })).toBe('');
        });

        it('does not reload positional identities', async () => {
            const page = fakePage('https://grok.com/c/0f3c6a52-1b2c-4d5e-8f90-123456789abc', []);
            expect(await __test__.rereadFinalAnswer(page, { id: 'pos-1-assistant', text: 'answer' })).toBe('');
            expect(page.visited).toEqual([]);
        });

        it('returns an empty string when the tab is not on a conversation', async () => {
            const page = fakePage('https://grok.com/', []);
            expect(await __test__.rereadFinalAnswer(page, { id: 'a1-assistant', text: 'the whole answer' })).toBe('');
            expect(page.visited).toEqual([]);
        });
    });
});
