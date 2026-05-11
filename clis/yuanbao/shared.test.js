import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { normalizeBooleanFlag, parseYuanbaoSessionId } from './shared.js';

describe('yuanbao parseYuanbaoSessionId', () => {
    const agentId = 'naQivTmsDa';
    const convId = 'b1118732-15ca-42cc-bc9a-e40090ccfb8c';

    it('extracts agent + conv from a full chat URL', () => {
        expect(parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId}`))
            .toEqual({ agentId, convId });
    });

    it('extracts agent + conv from URL with query string or fragment', () => {
        expect(parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId}?ref=share`))
            .toEqual({ agentId, convId });
        expect(parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId}#anchor`))
            .toEqual({ agentId, convId });
    });

    it('lowercases the conv UUID', () => {
        expect(parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId.toUpperCase()}`))
            .toEqual({ agentId, convId });
    });

    it('accepts a bare "<agentId>/<convId>" pair', () => {
        expect(parseYuanbaoSessionId(`${agentId}/${convId}`)).toEqual({ agentId, convId });
    });

    it('throws on empty / blank input', () => {
        expect(() => parseYuanbaoSessionId('')).toThrow(ArgumentError);
        expect(() => parseYuanbaoSessionId('   ')).toThrow(ArgumentError);
        expect(() => parseYuanbaoSessionId(null)).toThrow(ArgumentError);
        expect(() => parseYuanbaoSessionId(undefined)).toThrow(ArgumentError);
    });

    it('rejects a bare conv UUID (Yuanbao requires the agent slug)', () => {
        expect(() => parseYuanbaoSessionId(convId)).toThrow(ArgumentError);
    });

    it('rejects a URL with a 37+ char conv tail (no silent truncation)', () => {
        // Boundary regression: without `(?:[/?#]|$)` the regex would happily
        // match the first 36 chars and silently open a different conversation.
        expect(() => parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId}extra`))
            .toThrow(ArgumentError);
        expect(() => parseYuanbaoSessionId(`https://yuanbao.tencent.com/chat/${agentId}/${convId}0000`))
            .toThrow(ArgumentError);
    });

    it('rejects malformed shapes with actionable messages', () => {
        expect(() => parseYuanbaoSessionId('abc')).toThrow(ArgumentError);
        expect(() => parseYuanbaoSessionId('https://yuanbao.tencent.com/somewhere/else')).toThrow(ArgumentError);
        // agent slug too short to be valid
        expect(() => parseYuanbaoSessionId(`abc/${convId}`)).toThrow(ArgumentError);
        // conv part not a UUID
        expect(() => parseYuanbaoSessionId(`${agentId}/not-a-uuid-at-all`)).toThrow(ArgumentError);
    });
});

describe('yuanbao normalizeBooleanFlag', () => {
    it('passes through real booleans', () => {
        expect(normalizeBooleanFlag(true, false)).toBe(true);
        expect(normalizeBooleanFlag(false, true)).toBe(false);
    });

    it('returns fallback for null/empty', () => {
        expect(normalizeBooleanFlag(undefined, true)).toBe(true);
        expect(normalizeBooleanFlag(null, false)).toBe(false);
        expect(normalizeBooleanFlag('', true)).toBe(true);
    });

    it('parses common truthy / falsy strings', () => {
        for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
            expect(normalizeBooleanFlag(v, false)).toBe(true);
        }
        for (const v of ['false', '0', 'no', 'off', 'unknown']) {
            expect(normalizeBooleanFlag(v, true)).toBe(false);
        }
    });
});
