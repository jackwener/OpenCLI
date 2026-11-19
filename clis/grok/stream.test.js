import { describe, expect, it } from 'vitest';
import { __test__ } from './stream.js';

const { iterFrames, summarizeResponse } = __test__;

// Hand-crafted body mirroring the shape sniffed from grok.com's
// `POST /rest/app-chat/conversations/new` SSE response — see the adjacent
// `stream.js` doc comment for the live capture flow.
const SAMPLE_BODY = [
    '{"result":{"conversation":{"conversationId":"00000000-1111-2222-3333-444444444444","title":"New conversation","createTime":"2026-05-26T17:34:13.212874Z"}}}',
    '{"result":{"response":{"userResponse":{"responseId":"u1","message":"hi"}}}}',
    '{"result":{"response":{"llmInfo":{"modelHash":"abc"},"responseId":"r1"}}}',
    '{"result":{"response":{"token":"Thinking","isThinking":true,"messageTag":"header","responseId":"r1"}}}',
    '{"result":{"response":{"token":" about ","isThinking":true,"responseId":"r1"}}}',
    '{"result":{"response":{"token":"your request","isThinking":true,"responseId":"r1"}}}',
    '{"result":{"response":{"token":"po","isThinking":false,"messageTag":"final","responseId":"r1"}}}',
    '{"result":{"response":{"token":"ng","isThinking":false,"responseId":"r1"}}}',
    '{"result":{"response":{"modelResponse":{"responseId":"r1","model":"grok-3","message":"pong","generatedImageUrls":[]}}}}',
    '{"result":{"title":{"newTitle":"Pong"}}}',
].join('\n');

describe('grok stream parser', () => {
    describe('iterFrames', () => {
        it('yields one parsed object per non-empty line and skips malformed lines', () => {
            const body = '{"a":1}\n\n   \nnot json\n{"b":2}\n';
            expect(Array.from(iterFrames(body))).toEqual([{ a: 1 }, { b: 2 }]);
        });

        it('returns nothing for empty input', () => {
            expect(Array.from(iterFrames(''))).toEqual([]);
            expect(Array.from(iterFrames(undefined))).toEqual([]);
        });
    });

    describe('summarizeResponse', () => {
        const row = summarizeResponse(SAMPLE_BODY);

        it('extracts the final assistant text, preferring modelResponse over the token stream', () => {
            expect(row.response).toBe('pong');
        });

        it('joins the thinking-tagged tokens into the thinking field', () => {
            expect(row.thinking).toBe('Thinking about your request');
        });

        it('surfaces the conversationId, responseId, model, and title for the agent', () => {
            expect(row.conversationId).toBe('00000000-1111-2222-3333-444444444444');
            expect(row.responseId).toBe('r1');
            expect(row.model).toBe('grok-3');
            expect(row.title).toBe('Pong');
        });

        it('returns generated image URLs as a newline-joined string', () => {
            const bodyWithImages = SAMPLE_BODY.replace(
                '"generatedImageUrls":[]',
                '"generatedImageUrls":["https://assets.grok.com/a.jpg","https://assets.grok.com/b.jpg"]',
            );
            expect(summarizeResponse(bodyWithImages).images)
                .toBe('https://assets.grok.com/a.jpg\nhttps://assets.grok.com/b.jpg');
        });

        it('falls back to the streamed token concatenation when modelResponse is absent', () => {
            const partial = SAMPLE_BODY.split('\n').slice(0, -2).join('\n');
            expect(summarizeResponse(partial).response).toBe('pong');
        });

        it('handles an empty body without throwing', () => {
            const empty = summarizeResponse('');
            expect(empty.response).toBe('');
            expect(empty.thinking).toBe('');
            expect(empty.model).toBe('');
            expect(empty.images).toBe('');
        });
    });
});
