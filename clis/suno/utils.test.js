import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
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
    ensureSunoSession,
    parseSunoBillingInfo,
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

describe('suno utils — parseSunoBillingInfo', () => {
    it('resolves the free-tier plan when subscription_type is false (#1704)', () => {
        const parsed = parseSunoBillingInfo({
            subscription_type: false,
            credits: 0,
            monthly_limit: 50,
            monthly_usage: 10,
            total_credits_left: 40,
            credit_packs: [],
            plans: [
                { id: '4497580c-f4eb-4f86-9f0e-960eb7c48d7d', name: 'Free Plan', plan_key: 'free', level: 0 },
                { id: '3eaebef3-ef46-446a-931c-3d50cd1514f1', name: 'Pro Plan', plan_key: 'pro', level: 10 },
            ],
        });
        expect(parsed.planId).toBe('4497580c-f4eb-4f86-9f0e-960eb7c48d7d');
        expect(parsed.planKey).toBe('free');
        expect(parsed.totalCreditsAvailable).toBe(40);
        expect(parsed.breakdown.monthlyRemaining).toBe(40);
        expect(parsed.breakdown.monthlyLimit).toBe(50);
    });

    it('resolves the paid-tier plan when subscription_type matches a plan_key', () => {
        const parsed = parseSunoBillingInfo({
            subscription_type: 'pro',
            credits: 0,
            monthly_limit: 2500,
            monthly_usage: 100,
            total_credits_left: 2400,
            credit_packs: [{ id: 'pack-1', amount: 500 }],
            plans: [
                { id: 'free-uuid', name: 'Free Plan', plan_key: 'free', level: 0 },
                { id: 'pro-uuid', name: 'Pro Plan', plan_key: 'pro', level: 10 },
            ],
        });
        expect(parsed.planId).toBe('pro-uuid');
        expect(parsed.planKey).toBe('pro');
        expect(parsed.totalCreditsAvailable).toBe(2400);
    });

    it('falls back to subscription_type as planKey when plans[] lookup misses', () => {
        const parsed = parseSunoBillingInfo({
            subscription_type: 'enterprise',
            plans: [{ plan_key: 'pro' }, { plan_key: 'premier' }],
        });
        expect(parsed.planId).toBeNull();
        expect(parsed.planKey).toBe('enterprise');
    });

    it('returns planId null when plans[] is missing and there is no legacy plan field', () => {
        const parsed = parseSunoBillingInfo({ subscription_type: false });
        expect(parsed.planId).toBeNull();
        expect(parsed.planKey).toBe('free');
    });

    it('honours the legacy data.plan field when plans[] does not surface a match', () => {
        const parsed = parseSunoBillingInfo({
            subscription_type: false,
            plan: { id: 'legacy-uuid', plan_key: 'legacy' },
        });
        expect(parsed.planId).toBe('legacy-uuid');
        expect(parsed.planKey).toBe('legacy');
    });

    it('sums credit_packs by amount and falls back to legacy credits field', () => {
        const parsed = parseSunoBillingInfo({
            subscription_type: false,
            credits: 5,
            monthly_limit: 0,
            monthly_usage: 0,
            credit_packs: [{ amount: 100 }, { credits: 50 }],
            plans: [{ plan_key: 'free' }],
        });
        expect(parsed.breakdown.pack).toBe(5);
        expect(parsed.breakdown.purchasedPacks).toBe(150);
        expect(parsed.totalCreditsAvailable).toBe(155);
    });
});

describe('suno utils — ensureSunoSession typed failures', () => {
    function createSessionPage(sessionCheckResult) {
        const evaluate = async (script) => {
            if (script.includes('querySelectorAll')) return undefined;
            if (script.includes('!!(window.Clerk && window.Clerk.session)')) return true;
            if (script.includes('suno_device_id')) return 'device-id';
            if (script.includes('/api/billing/info/')) return sessionCheckResult;
            throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
        };
        return {
            goto: async () => undefined,
            wait: async () => undefined,
            evaluate,
        };
    }

    it('maps explicit logged-out session state to AuthRequiredError', async () => {
        await expect(ensureSunoSession(createSessionPage({
            ok: false,
            auth: true,
            error: 'Clerk session unavailable',
        }))).rejects.toThrowError(AuthRequiredError);
    });

    it('does not classify billing/parser drift as logged out', async () => {
        await expect(ensureSunoSession(createSessionPage({
            ok: false,
            error: 'Malformed billing/info JSON: Unexpected token <',
        }))).rejects.toThrowError(CommandExecutionError);
    });

    it('resolves a free-tier session without throwing when subscription_type is false (#1704)', async () => {
        const session = await ensureSunoSession(createSessionPage({
            ok: true,
            planId: '4497580c-f4eb-4f86-9f0e-960eb7c48d7d',
            planKey: 'free',
            planName: 'Free Plan',
            totalCreditsAvailable: 40,
            breakdown: { pack: 0, purchasedPacks: 0, monthlyRemaining: 40, monthlyLimit: 50, monthlyUsed: 10 },
        }));
        expect(session.planKey).toBe('free');
        expect(session.planId).toBe('4497580c-f4eb-4f86-9f0e-960eb7c48d7d');
        expect(session.totalCreditsAvailable).toBe(40);
    });

    it('still resolves when planId is null so read commands work even on unparseable plan shapes', async () => {
        const session = await ensureSunoSession(createSessionPage({
            ok: true,
            planId: null,
            planKey: 'free',
            planName: null,
            totalCreditsAvailable: 0,
            breakdown: { pack: 0, purchasedPacks: 0, monthlyRemaining: 0, monthlyLimit: 0, monthlyUsed: 0 },
        }));
        expect(session.planId).toBeNull();
        expect(session.planKey).toBe('free');
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
