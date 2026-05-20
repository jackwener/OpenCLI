import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './create.js';

const { parseCreateTitle, parseCreateEmoji, parseCreateProjectResult } = __test__;

describe('notebooklm create', () => {
    it('parseCreateTitle trims and accepts 1-200 char titles', () => {
        expect(parseCreateTitle('hello')).toBe('hello');
        expect(parseCreateTitle('  spaced  ')).toBe('spaced');
        expect(parseCreateTitle('x'.repeat(200))).toHaveLength(200);
    });

    it('parseCreateTitle rejects empty / too-long titles', () => {
        expect(() => parseCreateTitle('')).toThrow(ArgumentError);
        expect(() => parseCreateTitle('   ')).toThrow(ArgumentError);
        expect(() => parseCreateTitle(undefined)).toThrow(ArgumentError);
        expect(() => parseCreateTitle('x'.repeat(201))).toThrow(ArgumentError);
    });

    it('parseCreateEmoji defaults to the notebook icon when empty', () => {
        expect(parseCreateEmoji(undefined)).toBe('📒');
        expect(parseCreateEmoji('')).toBe('📒');
        expect(parseCreateEmoji('   ')).toBe('📒');
    });

    it('parseCreateEmoji passes through user-provided emoji', () => {
        expect(parseCreateEmoji('🧪')).toBe('🧪');
        expect(parseCreateEmoji('  🎓 ')).toBe('🎓');
    });

    it('parseCreateProjectResult extracts the notebook id from the singleton-wrapped RPC result', () => {
        const result = [[ ['notebook-payload-prefix', null, 'ec806f5b-fe74-4588-8f77-f073b91e9b1e', 'opencli-test', '🧪'] ]];
        expect(parseCreateProjectResult(result)).toBe('ec806f5b-fe74-4588-8f77-f073b91e9b1e');
    });

    it('parseCreateProjectResult falls back to index 0 when index 2 is missing', () => {
        const result = ['some-id', null];
        expect(parseCreateProjectResult(result)).toBe('some-id');
    });

    it('parseCreateProjectResult returns empty string on unparseable shapes', () => {
        expect(parseCreateProjectResult(null)).toBe('');
        expect(parseCreateProjectResult({})).toBe('');
        expect(parseCreateProjectResult([])).toBe('');
        expect(parseCreateProjectResult([null, null, null])).toBe('');
    });
});
