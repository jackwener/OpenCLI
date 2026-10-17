import { describe, expect, it } from 'vitest';

import { ArgumentError } from '@jackwener/opencli/errors';
import { parseRedditSubscribedLimit, unwrapEvaluateResult } from './subscribed.js';

describe('reddit subscribed adapter', () => {
    it('parseRedditSubscribedLimit rejects out-of-range values without silent clamp', () => {
        expect(parseRedditSubscribedLimit(undefined)).toBe(100);
        expect(parseRedditSubscribedLimit(null)).toBe(100);
        expect(parseRedditSubscribedLimit('')).toBe(100);
        expect(parseRedditSubscribedLimit(1)).toBe(1);
        expect(parseRedditSubscribedLimit(1000)).toBe(1000);
        for (const bad of [0, -1, 1001, 1.5, NaN, 'abc']) {
            expect(() => parseRedditSubscribedLimit(bad)).toThrow(ArgumentError);
        }
    });

    it('unwraps Browser Bridge envelopes', () => {
        const inner = { kind: 'ok', entries: [] };
        expect(unwrapEvaluateResult({ session: 'browser:default', data: inner })).toBe(inner);
        expect(unwrapEvaluateResult(inner)).toBe(inner);
    });

});
