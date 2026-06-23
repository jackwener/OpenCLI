import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { __test__ } from './image.js';

const { expandHome } = __test__;

describe('expandHome', () => {
    it('expands a bare ~ to the home directory', () => {
        expect(expandHome('~')).toBe(os.homedir());
    });
    it('expands a ~/ prefix to the home directory', () => {
        expect(expandHome('~/tmp/gemini-images')).toBe(path.join(os.homedir(), 'tmp', 'gemini-images'));
    });
    it('leaves absolute paths untouched', () => {
        expect(expandHome('/tmp/out')).toBe('/tmp/out');
    });
    it('leaves a leading ~user (not ~/) untouched', () => {
        expect(expandHome('~someone/dir')).toBe('~someone/dir');
    });
});
