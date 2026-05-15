import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    requireArrayEvaluateResult,
    requireBooleanEvaluateResult,
    requireObjectEvaluateResult,
    unwrapEvaluateResult,
} from './utils.js';

describe('chatgpt page.evaluate envelope helpers', () => {
    describe('unwrapEvaluateResult', () => {
        it('unwraps a { session, data } envelope produced by the browser bridge', () => {
            const envelope = { session: 'site:chatgpt:abc', data: [{ id: 'msg-1' }] };
            expect(unwrapEvaluateResult(envelope)).toEqual([{ id: 'msg-1' }]);
        });

        it('passes raw arrays through unchanged (back-compat with older bridge versions)', () => {
            const raw = [1, 2, 3];
            expect(unwrapEvaluateResult(raw)).toBe(raw);
        });

        it('passes primitive return values (URL strings, booleans) through unchanged', () => {
            expect(unwrapEvaluateResult('https://chatgpt.com/c/abc')).toBe('https://chatgpt.com/c/abc');
            expect(unwrapEvaluateResult(true)).toBe(true);
            expect(unwrapEvaluateResult(0)).toBe(0);
        });

        it('passes plain non-envelope objects through unchanged', () => {
            const obj = { ok: true, reason: 'all good' };
            expect(unwrapEvaluateResult(obj)).toBe(obj);
        });

        it('handles null and undefined defensively', () => {
            expect(unwrapEvaluateResult(null)).toBe(null);
            expect(unwrapEvaluateResult(undefined)).toBe(undefined);
        });
    });

    describe('requireArrayEvaluateResult', () => {
        it('returns the payload when it is an array', () => {
            const rows = [{ id: 1 }, { id: 2 }];
            expect(requireArrayEvaluateResult(rows, 'chatgpt test')).toBe(rows);
        });

        it('throws a typed CommandExecutionError when the payload is the raw envelope (caller forgot to unwrap)', () => {
            const envelope = { session: 'site:chatgpt:abc', data: [{ id: 1 }] };
            expect(() => requireArrayEvaluateResult(envelope, 'chatgpt visible image url extraction'))
                .toThrowError(CommandExecutionError);
            expect(() => requireArrayEvaluateResult(envelope, 'chatgpt visible image url extraction'))
                .toThrow(/malformed extraction payload/);
        });

        it('surfaces the inner error message when the payload carries an `error` field', () => {
            const errPayload = { error: 'image generator returned 500' };
            expect(() => requireArrayEvaluateResult(errPayload, 'chatgpt image asset export'))
                .toThrow(/chatgpt image asset export: image generator returned 500/);
        });

        it('throws when the payload is null or a primitive', () => {
            expect(() => requireArrayEvaluateResult(null, 'chatgpt test')).toThrowError(CommandExecutionError);
            expect(() => requireArrayEvaluateResult('a string', 'chatgpt test')).toThrowError(CommandExecutionError);
        });
    });

    describe('requireObjectEvaluateResult', () => {
        it('returns the payload when it is a plain object', () => {
            const obj = { url: 'https://chatgpt.com', isLoggedIn: true };
            expect(requireObjectEvaluateResult(obj, 'chatgpt page state')).toBe(obj);
        });

        it('throws when the payload is an array or a primitive', () => {
            expect(() => requireObjectEvaluateResult([], 'chatgpt page state')).toThrowError(CommandExecutionError);
            expect(() => requireObjectEvaluateResult('string', 'chatgpt page state')).toThrowError(CommandExecutionError);
            expect(() => requireObjectEvaluateResult(null, 'chatgpt page state')).toThrowError(CommandExecutionError);
        });
    });

    describe('requireBooleanEvaluateResult', () => {
        it('returns booleans and rejects wrong-shape values', () => {
            expect(requireBooleanEvaluateResult(true, 'chatgpt generation state')).toBe(true);
            expect(requireBooleanEvaluateResult(false, 'chatgpt generation state')).toBe(false);
            expect(() => requireBooleanEvaluateResult({ ok: true }, 'chatgpt generation state'))
                .toThrowError(CommandExecutionError);
        });
    });

    describe('end-to-end envelope sweep', () => {
        // The bridge envelope is shaped like { session, data } where `session` is
        // any string and `data` is the actual return value. Verify the helpers
        // chain correctly: unwrap → require* yields the inner shape.
        it('unwrap + requireArray pipes an envelope through to the underlying array', () => {
            const envelope = {
                session: 'site:chatgpt:img-export',
                data: [
                    { url: 'https://a.example/1.png', dataUrl: 'data:image/png;base64,xxx', mimeType: 'image/png' },
                ],
            };
            expect(requireArrayEvaluateResult(unwrapEvaluateResult(envelope), 'chatgpt image asset export'))
                .toEqual(envelope.data);
        });

        it('unwrap + requireObject pipes an envelope through to the underlying object', () => {
            const envelope = { session: 'site:chatgpt:state', data: { url: 'https://chatgpt.com', isLoggedIn: true } };
            expect(requireObjectEvaluateResult(unwrapEvaluateResult(envelope), 'chatgpt page state'))
                .toEqual(envelope.data);
        });
    });
});
