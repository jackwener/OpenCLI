import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DEFAULT_FORMATS,
    SUPPORTED_FORMATS,
    SUNO_MODELS,
    clampSlider,
    normalizeBooleanFlag,
    requireNonNegativeInt,
    parseFormats,
    requirePositiveInt,
    resolveSunoOutputDir,
    sanitizeTitleForFilename,
    unwrapEvaluateResult,
    pollSunoClips,
} from './utils.js';

describe('suno utils — parseFormats', () => {
    it('returns the default format set when input is empty or missing', () => {
        expect(parseFormats(undefined)).toEqual(DEFAULT_FORMATS);
        expect(parseFormats(null)).toEqual(DEFAULT_FORMATS);
        expect(parseFormats('')).toEqual(DEFAULT_FORMATS);
        expect(parseFormats('   ')).toEqual(DEFAULT_FORMATS);
    });

    it('parses comma-separated input and trims whitespace', () => {
        expect(parseFormats('mp3, wav, metadata')).toEqual(['mp3', 'wav', 'metadata']);
    });

    it('lowercases and deduplicates input', () => {
        expect(parseFormats('MP3,Mp3,mp3,WAV')).toEqual(['mp3', 'wav']);
    });

    it('accepts array inputs (e.g. when caller passes pre-split values)', () => {
        expect(parseFormats(['mp3', 'metadata'])).toEqual(['mp3', 'metadata']);
    });

    it('throws ArgumentError on unsupported format and lists the supported set', () => {
        try {
            parseFormats('mp3,flac');
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ArgumentError);
            expect(err.message).toContain('flac');
            expect(err.hint).toContain(SUPPORTED_FORMATS.join(', '));
        }
    });
});

describe('suno utils — resolveSunoOutputDir', () => {
    it('falls back to ~/Music/suno when no path is given', () => {
        expect(resolveSunoOutputDir()).toBe(path.join(os.homedir(), 'Music', 'suno'));
        expect(resolveSunoOutputDir('')).toBe(path.join(os.homedir(), 'Music', 'suno'));
    });

    it('expands ~ and ~/-prefixed relative paths to the home directory', () => {
        expect(resolveSunoOutputDir('~')).toBe(os.homedir());
        expect(resolveSunoOutputDir('~/Music/test')).toBe(path.join(os.homedir(), 'Music', 'test'));
    });

    it('absolute paths are returned as-is (resolved)', () => {
        expect(resolveSunoOutputDir('/tmp/suno')).toBe('/tmp/suno');
    });
});

describe('suno utils — sanitizeTitleForFilename', () => {
    it('replaces filesystem-hostile characters with hyphens', () => {
        expect(sanitizeTitleForFilename('foo/bar:baz?')).toBe('foo-bar-baz-');
    });

    it('collapses whitespace and trims', () => {
        expect(sanitizeTitleForFilename('  hello   world  ')).toBe('hello world');
    });

    it('caps length at 60 characters', () => {
        const long = 'a'.repeat(120);
        expect(sanitizeTitleForFilename(long).length).toBe(60);
    });

    it('returns fallback for empty input', () => {
        expect(sanitizeTitleForFilename('', 'untitled')).toBe('untitled');
        expect(sanitizeTitleForFilename(null, 'fallback')).toBe('fallback');
    });
});

describe('suno utils — clampSlider', () => {
    it('returns the default when input is missing', () => {
        expect(clampSlider(undefined, '--weirdness', 0.5)).toBe(0.5);
        expect(clampSlider('', '--weirdness', 0.5)).toBe(0.5);
        expect(clampSlider(null, '--weirdness', 0.5)).toBe(0.5);
    });

    it('parses numeric strings and accepts 0..1', () => {
        expect(clampSlider('0', '--x', 0.5)).toBe(0);
        expect(clampSlider('0.74', '--x', 0.5)).toBe(0.74);
        expect(clampSlider('1', '--x', 0.5)).toBe(1);
    });

    it('rejects out-of-range or non-numeric values', () => {
        expect(() => clampSlider('1.5', '--x', 0.5)).toThrowError(ArgumentError);
        expect(() => clampSlider('-0.1', '--x', 0.5)).toThrowError(ArgumentError);
        expect(() => clampSlider('hello', '--x', 0.5)).toThrowError(ArgumentError);
    });
});

describe('suno utils — normalizeBooleanFlag', () => {
    it('treats the canonical true-ish strings as true', () => {
        for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'On']) {
            expect(normalizeBooleanFlag(v)).toBe(true);
        }
    });

    it('treats unset / empty / unrecognized values as the fallback', () => {
        expect(normalizeBooleanFlag(undefined)).toBe(false);
        expect(normalizeBooleanFlag('', true)).toBe(true);
        expect(normalizeBooleanFlag('maybe')).toBe(false);
    });

    it('passes through actual booleans', () => {
        expect(normalizeBooleanFlag(true)).toBe(true);
        expect(normalizeBooleanFlag(false)).toBe(false);
    });
});

describe('suno utils — requirePositiveInt', () => {
    it('returns positive integers as numbers', () => {
        expect(requirePositiveInt(5, '--limit')).toBe(5);
        expect(requirePositiveInt('10', '--limit')).toBe(10);
    });

    it('rejects zero, negative, and non-integer values', () => {
        expect(() => requirePositiveInt(0, '--limit')).toThrowError(ArgumentError);
        expect(() => requirePositiveInt(-3, '--limit')).toThrowError(ArgumentError);
        expect(() => requirePositiveInt(1.5, '--limit')).toThrowError(ArgumentError);
        expect(() => requirePositiveInt('not a number', '--limit')).toThrowError(ArgumentError);
    });
});

describe('suno utils — requireNonNegativeInt', () => {
    it('returns zero and positive integers as numbers', () => {
        expect(requireNonNegativeInt(0, '--page')).toBe(0);
        expect(requireNonNegativeInt('3', '--page')).toBe(3);
    });

    it('rejects negative or non-integer values', () => {
        expect(() => requireNonNegativeInt(-1, '--page')).toThrowError(ArgumentError);
        expect(() => requireNonNegativeInt(1.5, '--page')).toThrowError(ArgumentError);
        expect(() => requireNonNegativeInt('nope', '--page')).toThrowError(ArgumentError);
    });
});

describe('suno utils — unwrapEvaluateResult', () => {
    it('unwraps Browser Bridge envelopes at evaluate boundaries', () => {
        const payload = { ok: true, clips: [] };
        expect(unwrapEvaluateResult({ session: 'browser:default', data: payload })).toBe(payload);
        expect(unwrapEvaluateResult(payload)).toBe(payload);
    });
});

describe('suno utils — model + format exports', () => {
    it('exposes the four shipping models with chirp-fenix first', () => {
        expect(SUNO_MODELS).toContain('chirp-fenix');
        expect(SUNO_MODELS).toContain('chirp-bluejay');
        expect(SUNO_MODELS[0]).toBe('chirp-fenix');
    });

    it('declares mp3 + metadata as the default download set', () => {
        expect(DEFAULT_FORMATS).toEqual(['mp3', 'metadata']);
    });
});

describe('suno utils — pollSunoClips', () => {
    it('fails typed on malformed feed JSON while polling generation status', async () => {
        const page = {
            evaluate: async () => ({ status: 200, body: null }),
            wait: async () => {},
        };
        await expect(pollSunoClips(page, ['clip-a'], 1, 'device-id', 0)).rejects.toThrowError(CommandExecutionError);
    });

    it('fails typed on non-auth HTTP feed failures while polling generation status', async () => {
        const page = {
            evaluate: async () => ({ status: 500, body: { clips: [] } }),
            wait: async () => {},
        };
        await expect(pollSunoClips(page, ['clip-a'], 1, 'device-id', 0)).rejects.toThrowError(CommandExecutionError);
    });
});
