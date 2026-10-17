// Contract tests for the Phase-3 P0.5 refactor that retired the legacy
// pipeline-based silent-failure pattern across comment / follow / unfollow.
//
// Each adapter is now `func + Strategy.COOKIE + browser:true` with a
// shared button-walker helper bundle from utils.js. These tests pin
// down (a) registration metadata, (b) typed-error boundary, including
// the retryable-hint contract that distinguishes server-fan-out
// (comment) from idempotent client-safe (follow / unfollow) failures,
// (c) build-script invariants — sentinels, login + rate-limit guards,
// expected button labels and selectors.

import { describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';
import { commentCommand } from './comment.js';
import { followCommand } from './follow.js';
import { unfollowCommand } from './unfollow.js';
import {
    COMMENT_TEXT_MAX,
    RETRYABLE_HINTS,
    parseTikTokVideoUrl,
    requireCommentText,
    throwButtonWalkerError,
} from './utils.js';

function makePage(rows) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(rows),
    };
}

function makeFailingPage(error) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockRejectedValue(error),
    };
}

function makeGotoFailingPage(error) {
    return {
        goto: vi.fn().mockRejectedValue(error),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
    };
}

const VIDEO_URL = 'https://www.tiktok.com/@creator/video/7350000000000000000';

const sampleCommentRow = { url: VIDEO_URL, text: 'great clip', result: 'posted' };
const sampleFollowRow = { username: 'creator', url: 'https://www.tiktok.com/@creator', result: 'followed' };
const sampleUnfollowRow = { username: 'creator', url: 'https://www.tiktok.com/@creator', result: 'unfollowed' };

describe('tiktok/utils (P0.5 button-walker additions)', () => {
    it('requireCommentText rejects empty / whitespace / overlong with ArgumentError', () => {
        expect(() => requireCommentText('')).toThrow(ArgumentError);
        expect(() => requireCommentText('   ')).toThrow(ArgumentError);
        expect(() => requireCommentText(undefined)).toThrow(ArgumentError);
        expect(() => requireCommentText('x'.repeat(COMMENT_TEXT_MAX + 1))).toThrow(ArgumentError);
        expect(requireCommentText('  hello  ')).toBe('hello');
        expect(requireCommentText('x'.repeat(COMMENT_TEXT_MAX))).toHaveLength(COMMENT_TEXT_MAX);
    });

    it('parseTikTokVideoUrl rejects non-tiktok / bad shape and accepts canonical URL', () => {
        expect(() => parseTikTokVideoUrl('')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('not a url')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('https://example.com/@u/video/123')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('https://www.tiktok.com/@user/photo/123')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('https://www.tiktok.com/@user/video/123abc')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('https://www.tiktok.com/@user/video/123/extra')).toThrow(ArgumentError);
        expect(() => parseTikTokVideoUrl('https://vm.tiktok.com/abc')).toThrow(ArgumentError);
        const parsed = parseTikTokVideoUrl(VIDEO_URL);
        expect(parsed.username).toBe('creator');
        expect(parsed.videoId).toBe('7350000000000000000');
        expect(parsed.url).toBe(VIDEO_URL);
        // accepts a trailing slash plus query string, but not extra path segments
        expect(parseTikTokVideoUrl(`${VIDEO_URL}/?lang=en`).videoId).toBe('7350000000000000000');
    });

    it('throwButtonWalkerError maps AUTH_REQUIRED-shaped messages to AuthRequiredError', () => {
        expect(() => throwButtonWalkerError(new Error('AUTH_REQUIRED: login required'), {
            authMessage: 'login pls',
            failureMessage: 'op failed',
            retryableHint: RETRYABLE_HINTS.relationFailure,
        })).toThrow(AuthRequiredError);
    });

    it('throwButtonWalkerError keeps captcha / rate-limit as retryable CommandExecutionError, not AuthRequiredError', () => {
        for (const message of [
            'RATE_LIMITED: TikTok rate limit / captcha detected',
            'captcha verification needed',
            'Too many requests, try again later',
        ]) {
            try {
                throwButtonWalkerError(new Error(message), {
                    authMessage: 'login pls',
                    failureMessage: 'op failed',
                    retryableHint: RETRYABLE_HINTS.relationFailure,
                });
                throw new Error('should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(CommandExecutionError);
                expect(err.hint).toMatch(/retryable=true/);
            }
        }
    });

    it('throwButtonWalkerError maps everything else to CommandExecutionError with retryable hint', () => {
        try {
            throwButtonWalkerError(new Error('BUTTON_NOT_FOUND: missing'), {
                authMessage: 'a',
                failureMessage: 'op failed',
                retryableHint: RETRYABLE_HINTS.commentFailure,
            });
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(CommandExecutionError);
            expect(err.message).toMatch(/op failed: BUTTON_NOT_FOUND/);
            expect(err.hint).toMatch(/retryable=false/);
        }
        try {
            throwButtonWalkerError(new Error('STATE_VERIFY_FAIL: did not flip'), {
                authMessage: 'login pls',
                failureMessage: 'op failed',
                retryableHint: RETRYABLE_HINTS.relationFailure,
            });
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(CommandExecutionError);
            expect(err.hint).toMatch(/retryable=true/);
        }
    });
});

describe('tiktok/comment (Route 1 button-walker refactor)', () => {
    it('validates --url and --text upfront before navigating', async () => {
        const page = makePage([sampleCommentRow]);
        await expect(commentCommand.func(page, { url: '', text: 'hi' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(commentCommand.func(page, { url: VIDEO_URL, text: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(commentCommand.func(page, { url: 'https://example.com/x', text: 'hi' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(commentCommand.func(page, { url: VIDEO_URL, text: 'x'.repeat(COMMENT_TEXT_MAX + 1) })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to the canonical video URL and returns the row from evaluate', async () => {
        const page = makePage([sampleCommentRow]);
        const rows = await commentCommand.func(page, { url: VIDEO_URL, text: 'great clip' });
        expect(page.goto).toHaveBeenCalledWith(VIDEO_URL, { waitUntil: 'load', settleMs: 6000 });
        expect(rows).toEqual([sampleCommentRow]);
    });

    it('maps page-evaluate errors to typed errors with comment retryable=false hint', async () => {
        await expect(commentCommand.func(
            makeFailingPage(new Error('AUTH_REQUIRED: TikTok login required')),
            { url: VIDEO_URL, text: 'hi' },
        )).rejects.toBeInstanceOf(AuthRequiredError);
        try {
            await commentCommand.func(
                makeFailingPage(new Error('STATE_VERIFY_FAIL: comment count did not increase')),
                { url: VIDEO_URL, text: 'hi' },
            );
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(CommandExecutionError);
            expect(err.message).toMatch(/Failed to post comment/);
            expect(err.hint).toMatch(/retryable=false/);
            expect(err.hint).toMatch(/server-fan-out/);
        }
    });

    it('maps navigation failures and empty evaluate rows to CommandExecutionError', async () => {
        await expect(commentCommand.func(
            makeGotoFailingPage(new Error('net::ERR_ABORTED')),
            { url: VIDEO_URL, text: 'hi' },
        )).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(commentCommand.func(
            makePage([]),
            { url: VIDEO_URL, text: 'hi' },
        )).rejects.toBeInstanceOf(CommandExecutionError);
    });

});

describe('tiktok/follow (Route 1 button-walker refactor)', () => {
    it('validates username upfront before navigating', async () => {
        const page = makePage([sampleFollowRow]);
        await expect(followCommand.func(page, { username: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(followCommand.func(page, { username: 'bad name' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to /@username (with @ stripped) and returns the row from evaluate', async () => {
        const page = makePage([sampleFollowRow]);
        const rows = await followCommand.func(page, { username: '@creator' });
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/@creator', { waitUntil: 'load', settleMs: 5000 });
        expect(rows).toEqual([sampleFollowRow]);
    });

    it('maps AUTH_REQUIRED to AuthRequiredError; other failures get retryable=true hint', async () => {
        await expect(followCommand.func(
            makeFailingPage(new Error('AUTH_REQUIRED: TikTok login required')),
            { username: 'creator' },
        )).rejects.toBeInstanceOf(AuthRequiredError);
        try {
            await followCommand.func(
                makeFailingPage(new Error('STATE_VERIFY_FAIL: follow button did not flip')),
                { username: 'creator' },
            );
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(CommandExecutionError);
            expect(err.message).toMatch(/Failed to follow @creator/);
            expect(err.hint).toMatch(/retryable=true/);
            expect(err.hint).toMatch(/idempotent/);
        }
    });

    it('maps navigation failures and empty evaluate rows to retryable CommandExecutionError', async () => {
        await expect(followCommand.func(
            makeGotoFailingPage(new Error('Execution context was destroyed')),
            { username: 'creator' },
        )).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(followCommand.func(
            makePage([]),
            { username: 'creator' },
        )).rejects.toMatchObject({ hint: expect.stringMatching(/retryable=true/) });
    });

});

describe('tiktok/unfollow (Route 1 button-walker refactor)', () => {
    it('validates username upfront before navigating', async () => {
        const page = makePage([sampleUnfollowRow]);
        await expect(unfollowCommand.func(page, { username: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(unfollowCommand.func(page, { username: 'bad/name' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('navigates to /@username and returns the row from evaluate', async () => {
        const page = makePage([sampleUnfollowRow]);
        const rows = await unfollowCommand.func(page, { username: 'creator' });
        expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/@creator', { waitUntil: 'load', settleMs: 5000 });
        expect(rows).toEqual([sampleUnfollowRow]);
    });

    it('maps AUTH_REQUIRED to AuthRequiredError; other failures get retryable=true hint', async () => {
        await expect(unfollowCommand.func(
            makeFailingPage(new Error('AUTH_REQUIRED: login required')),
            { username: 'creator' },
        )).rejects.toBeInstanceOf(AuthRequiredError);
        try {
            await unfollowCommand.func(
                makeFailingPage(new Error('STATE_VERIFY_FAIL: relation did not flip back')),
                { username: 'creator' },
            );
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(CommandExecutionError);
            expect(err.message).toMatch(/Failed to unfollow @creator/);
            expect(err.hint).toMatch(/retryable=true/);
            expect(err.hint).toMatch(/idempotent/);
        }
    });

    it('maps navigation failures and empty evaluate rows to retryable CommandExecutionError', async () => {
        await expect(unfollowCommand.func(
            makeGotoFailingPage(new Error('Execution context was destroyed')),
            { username: 'creator' },
        )).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(unfollowCommand.func(
            makePage([]),
            { username: 'creator' },
        )).rejects.toMatchObject({ hint: expect.stringMatching(/retryable=true/) });
    });

});
