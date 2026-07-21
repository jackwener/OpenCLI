import { describe, expect, it } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { assertOk } from './utils.js';

describe('assertOk', () => {
    it('returns silently on code 0', () => {
        expect(() => assertOk({ code: 0 })).not.toThrow();
    });

    it('maps expired cookie codes (7, 37) to AuthRequiredError', () => {
        expect(() => assertOk({ code: 7, message: 'expired' })).toThrow(AuthRequiredError);
        expect(() => assertOk({ code: 37, message: 'expired' })).toThrow(AuthRequiredError);
    });

    it('does not misclassify code 37 environment rejection as expired login', () => {
        let error;
        try {
            assertOk({ code: 37, message: '您的环境存在异常.' }, 'Boss search failed');
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(CommandExecutionError);
        expect(error).not.toBeInstanceOf(AuthRequiredError);
        expect(error.code).toBe('COMMAND_EXEC');
        expect(error.message).toContain('环境存在异常');
        expect(error.message).toContain('code=37');
        expect(error.hint).toContain('重新登录通常无法解决');
    });

    it('keeps code 37 login-expiry responses as auth required', () => {
        expect(() => assertOk({ code: 37, message: '登录状态已失效' })).toThrow(AuthRequiredError);
    });

    it('keeps code 7 responses as auth required', () => {
        expect(() => assertOk({ code: 7, message: '请重新登录' })).toThrow(AuthRequiredError);
    });

    it('maps code 24 (identity mismatch) to AuthRequiredError with recruiter-only hint', () => {
        try {
            assertOk({ code: 24, message: '请切换身份后再试' });
            throw new Error('assertOk should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(AuthRequiredError);
            expect(String(err.message)).toContain('招聘端');
        }
    });

    it('falls through to CommandExecutionError for other non-zero codes', () => {
        expect(() => assertOk({ code: 99, message: 'something else' }))
            .toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError on malformed (non-object) response', () => {
        expect(() => assertOk(null)).toThrow(CommandExecutionError);
        expect(() => assertOk('not-an-object')).toThrow(CommandExecutionError);
    });
});
