import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseQianwenSessionId } from './utils.js';

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
