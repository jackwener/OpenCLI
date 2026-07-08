import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseQianwenSessionId, waitForAnswer } from './utils.js';

describe('qwen waitForAnswer baseline anchoring', () => {
    // page.evaluate serves both getMessageBubbles (data-chat-question-wrap) and
    // hasLoginGate (alert-biz-modal); route by inspecting the injected JS.
    const fakePage = (bubbles) => ({
        wait: () => new Promise((r) => setTimeout(r, 5)),
        evaluate: (js) => Promise.resolve(
            String(js).includes('alert-biz-modal') ? false : bubbles,
        ),
    });

    it('does not return the pre-send assistant turn (it is skipped via baseline id)', async () => {
        // Only the previous, already-complete answer is present. With the
        // baseline anchored to its id, waitForAnswer must skip it and time out
        // rather than return the stale answer as the new reply.
        const bubbles = [{ id: 'a1', role: 'Assistant', text: 'old answer', html: '' }];
        const result = await waitForAnswer(fakePage(bubbles), 'new question', 0.05, 'a1');
        expect(result.status).toBe('timeout');
        expect(result.assistant).toBeUndefined();
    });

    it('returns only an assistant turn after the newly sent prompt', async () => {
        const bubbles = [
            { id: 'u1', role: 'User', text: 'old question', html: '' },
            { id: 'a1', role: 'Assistant', text: 'old answer', html: '' },
            { id: 'u2', role: 'User', text: 'new question', html: '' },
            { id: 'a2', role: 'Assistant', text: 'new answer', html: '<p>new answer</p>' },
        ];
        const result = await waitForAnswer(
            fakePage(bubbles),
            'new question',
            0.2,
            { lastBubbleId: 'a1', lastAssistantId: 'a1' },
        );
        expect(result.status).toBe('partial');
        expect(result.assistant).toEqual(bubbles[3]);
    });

    it('does not match a repeated prompt that existed before the pre-send anchor', async () => {
        const bubbles = [
            { id: 'u1', role: 'User', text: 'same prompt', html: '' },
            { id: 'a1', role: 'Assistant', text: 'old answer', html: '' },
        ];
        const result = await waitForAnswer(
            fakePage(bubbles),
            'same prompt',
            0.05,
            { lastBubbleId: 'a1', lastAssistantId: 'a1' },
        );
        expect(result.status).toBe('timeout');
        expect(result.assistant).toBeUndefined();
    });

    it('does not scan the visible transcript when a non-empty baseline anchor is missing', async () => {
        const bubbles = [
            { id: 'u1-new-visible-id', role: 'User', text: 'same prompt', html: '' },
            { id: 'a1-new-visible-id', role: 'Assistant', text: 'old answer', html: '' },
        ];
        const result = await waitForAnswer(
            fakePage(bubbles),
            'same prompt',
            0.05,
            { lastBubbleId: 'a-anchor-missing', lastAssistantId: 'a-anchor-missing' },
        );
        expect(result.status).toBe('timeout');
        expect(result.assistant).toBeUndefined();
    });

    it('supports a fresh chat with no baseline anchor', async () => {
        const bubbles = [
            { id: 'u1', role: 'User', text: 'fresh question', html: '' },
            { id: 'a1', role: 'Assistant', text: 'fresh answer', html: '' },
        ];
        const result = await waitForAnswer(
            fakePage(bubbles),
            'fresh question',
            0.2,
            { lastBubbleId: '', lastAssistantId: '' },
        );
        expect(result.status).toBe('partial');
        expect(result.assistant).toEqual(bubbles[1]);
    });
});

describe('qwen parseQianwenSessionId', () => {
    const id = 'abcd1234ef567890abcd1234ef567890';

    it('returns a bare 32-char hex ID unchanged', () => {
        expect(parseQianwenSessionId(id)).toBe(id);
    });

    it('lowercases an upper-case ID', () => {
        expect(parseQianwenSessionId(id.toUpperCase())).toBe(id);
    });

    it('extracts the session ID from a full qianwen.com chat URL', () => {
        expect(parseQianwenSessionId(`https://www.qianwen.com/chat/${id}`)).toBe(id);
        expect(parseQianwenSessionId(`https://www.qianwen.com/chat/${id}?from=share`)).toBe(id);
        expect(parseQianwenSessionId(`http://qianwen.com/chat/${id}`)).toBe(id);
    });

    it('throws ArgumentError on empty input', () => {
        expect(() => parseQianwenSessionId('')).toThrow(ArgumentError);
        expect(() => parseQianwenSessionId(null)).toThrow(ArgumentError);
        expect(() => parseQianwenSessionId(undefined)).toThrow(ArgumentError);
        expect(() => parseQianwenSessionId('   ')).toThrow(ArgumentError);
    });

    it('throws ArgumentError on non-hex input', () => {
        expect(() => parseQianwenSessionId('not-an-id')).toThrow(ArgumentError);
        expect(() => parseQianwenSessionId('123')).toThrow(ArgumentError);
        // 32 chars but not all hex
        expect(() => parseQianwenSessionId('zbcd1234ef567890abcd1234ef567890')).toThrow(ArgumentError);
        // 31 hex chars — too short
        expect(() => parseQianwenSessionId('abcd1234ef567890abcd1234ef56789')).toThrow(ArgumentError);
        // 33 hex chars — too long
        expect(() => parseQianwenSessionId('abcd1234ef567890abcd1234ef5678900')).toThrow(ArgumentError);
        // URL with the wrong path shape must not silently fall through.
        expect(() => parseQianwenSessionId('https://www.qianwen.com/somewhere/else')).toThrow(ArgumentError);
        // URL embedding a 33+ hex tail must not silently truncate to 32 chars
        // and open the wrong conversation.
        expect(() => parseQianwenSessionId(`https://www.qianwen.com/chat/${id}0`)).toThrow(ArgumentError);
        expect(() => parseQianwenSessionId(`https://www.qianwen.com/chat/${id}abc`)).toThrow(ArgumentError);
    });
});
